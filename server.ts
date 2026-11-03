import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { getBrandTemplateConfig, loadToprakConfig } from "./core/config";
import { ToprakOrchestrator } from "./core/orchestrator";
import { BrandDiscovery } from "./core/brand-discovery";
import { BrandKnowledgeStore } from "./core/brand-knowledge-store";
import { ToprakAiHub } from "./core/ai-hub";
import { CastingManager } from "./core/casting-manager";
import { ScenarioManager } from "./core/scenario-manager";
import { LearningEngine } from "./core/learning-engine";
import { TrendAgent } from "./agents/trend-agent";
import { TOPRAK_PLATFORMS, ToprakPlatform } from "./core/types";

const PORT = Number(process.env.TOPRAK_PORT || 3333);
const HOST = "127.0.0.1";
const config = loadToprakConfig();
const STORAGE_BAKED = path.resolve(config.storageDir, "baked");
const STORAGE_RAW = path.resolve(config.storageDir, "raw");
const STUDIO_STATE_PATH = path.resolve(config.storageDir, "studio_state.json");
const LEARNING_INTERVAL_MS = 30 * 60 * 1000; // 30 dakikada bir geri bildirim / öğrenme kontrolü

interface StudioModeState {
  geminiWebMode: boolean;
  updatedAt: string;
}

function readStudioState(): StudioModeState {
  try {
    if (fs.existsSync(STUDIO_STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STUDIO_STATE_PATH, "utf-8"));
      return {
        geminiWebMode: Boolean(raw.geminiWebMode),
        updatedAt: String(raw.updatedAt || new Date().toISOString()),
      };
    }
  } catch {
    // varsayılana düş
  }
  return { geminiWebMode: false, updatedAt: new Date().toISOString() };
}

function writeStudioState(geminiWebMode: boolean): StudioModeState {
  const dir = path.dirname(STUDIO_STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const next: StudioModeState = {
    geminiWebMode,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STUDIO_STATE_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function saveBinaryUpload(
  req: http.IncomingMessage,
  destFilePath: string,
  maxBytes = 180 * 1024 * 1024
): Promise<number> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const out = fs.createWriteStream(destFilePath);
    let total = 0;
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        out.destroy();
        req.destroy();
        try {
          if (fs.existsSync(destFilePath)) fs.unlinkSync(destFilePath);
        } catch {
          // yoksay
        }
        reject(new Error("Dosya boyutu sınırı aşıldı (Maksimum 180 MB)."));
        return;
      }
      out.write(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      out.end(() => resolve(total));
    });

    req.on("error", (err) => {
      if (aborted) return;
      out.destroy();
      reject(err);
    });

    out.on("error", (err) => {
      if (aborted) return;
      reject(err);
    });
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml",
};

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}

function parseBody(
  req: http.IncomingMessage,
  maxBytes = 1_048_576
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error("İstek gövdesi çok büyük (Maksimum 1 MB)."));
        return;
      }
      body += chunk.toString("utf-8");
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Geçersiz JSON gövdesi."));
      }
    });

    req.on("error", reject);
  });
}

function isSafeIdentifier(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  // 1. GÜVENLİ STATİK MEDYA SUNUCUSU (/media/batchId/file) — Path Traversal Korumalı
  if (pathname.startsWith("/media/") && req.method === "GET") {
    let relativePath = "";
    try {
      relativePath = decodeURIComponent(pathname.slice("/media/".length));
    } catch {
      res.writeHead(400);
      res.end("Geçersiz dosya yolu");
      return;
    }

    const filePath = path.resolve(STORAGE_BAKED, relativePath);
    if (!filePath.startsWith(STORAGE_BAKED + path.sep)) {
      res.writeHead(403);
      res.end("Yetkisiz dizin erişimi engellendi");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404);
    res.end("Dosya bulunamadı");
    return;
  }

  // 2. API: CANLI SOCIAL MARKALARINI VE SAĞLIKLI PLATFORMLARINI LİSTELE
  if (pathname === "/api/brands" && req.method === "GET") {
    try {
      const socialBrands = await BrandDiscovery.getAllActiveBrands();
      const enriched = socialBrands.map((b) => {
        const storedDna = BrandKnowledgeStore.getBrand(b.slug);
        const tpl = getBrandTemplateConfig(b.slug);
        const wisdom = LearningEngine.getWisdomForBrand(b.slug);
        return {
          id: b.id,
          slug: b.slug,
          name: b.name,
          sector: storedDna?.sector || tpl?.sector || "Dijital Ürün & Teknoloji",
          toneOfVoice: b.toneOfVoice || storedDna?.toneOfVoice || tpl?.toneOfVoice || "Profesyonel ve samimi",
          primaryColor: b.primaryColor,
          accentColor: b.accentColor,
          healthyPlatforms: b.healthyPlatforms,
          isQualified: b.healthyPlatforms.length > 0,
          accountsCount: b.accounts.length,
          analyzedPosts: wisdom.totalPostsAnalyzed,
        };
      });
      sendJson(res, 200, {
        brands: enriched,
        socialQueueUrl: `${loadToprakConfig().socialBaseUrl}/queue`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  // 3. API: MERKEZİ AI HUB & CAST AJANSI ÖZETİ
  if (pathname === "/api/hub-status" && req.method === "GET") {
    const routing = ToprakAiHub.getRoutingTableSummary();
    const summary = CastingManager.getPoolSummary();
    const modenaScenarios = ScenarioManager.getScenariosForBrand("modena");
    const cfg = loadToprakConfig();
    sendJson(res, 200, {
      providersConfigured: {
        groq: Boolean(cfg.groqApiKey),
        gemini: Boolean(cfg.geminiApiKey),
        openai: Boolean(cfg.openAiApiKey),
      },
      castCount: summary.total,
      castSummary: summary,
      scenarioPoolSummary: {
        modenaCount: modenaScenarios.length,
        modenaTitles: modenaScenarios.map((s) => s.titleTr),
      },
      agentPrimaryModels: Object.fromEntries(
        Object.entries(routing.agents).map(([role, specs]) => [
          role,
          `${specs[0].provider}/${specs[0].modelId}`,
        ])
      ),
    });
    return;
  }

  // 4. API: ÖĞRENME MOTORUNU MANUEL TETİKLE
  if (pathname === "/api/learning/sync" && req.method === "POST") {
    try {
      const results = await LearningEngine.syncAllQualifiedBrands();
      sendJson(res, 200, { ok: true, syncedCount: results.length, results });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  // 5. API: FIRINDAN ÇIKAN PAKETLERİ LİSTELE
  if (pathname === "/api/packages" && req.method === "GET") {
    const packages = [];
    if (fs.existsSync(STORAGE_BAKED)) {
      const dirs = fs.readdirSync(STORAGE_BAKED).sort().reverse();
      for (const d of dirs) {
        if (!isSafeIdentifier(d)) continue;
        const pkgJson = path.join(STORAGE_BAKED, d, "package.json");
        if (fs.existsSync(pkgJson)) {
          try {
            const data = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
            packages.push({
              batchId: data.batchId,
              brand: data.brand,
              topic: data.sourceMetadata?.topic || "İçerik",
              createdAt: data.createdAt,
              score: data.validation?.overallScore ?? 0,
              validationStatus: data.validation?.status || "APPROVED",
              packageStatus: data.status || "BAKED_READY",
              approvalStatus: data.socialHandoff?.approvalStatus || null,
              platforms: Object.keys(data.deliveries || {}),
              sourceMode: data.sourceMode,
              hasVideo: Boolean(data.media?.videoVertical),
              hasThumbnail: Boolean(data.media?.thumbnail),
              thumbnailUrl: data.media?.thumbnail
                ? `/media/${data.batchId}/${data.media.thumbnail.fileName}`
                : null,
              videoUrl: data.media?.videoVertical
                ? `/media/${data.batchId}/${data.media.videoVertical.fileName}`
                : null,
            });
          } catch {
            // Bozuk paketi yoksay
          }
        }
      }
    }
    sendJson(res, 200, { packages });
    return;
  }

  // 6. API: TEKİL PAKET DETAYI
  if (pathname.startsWith("/api/package/") && req.method === "GET") {
    const batchId = pathname.slice("/api/package/".length).trim();
    if (!isSafeIdentifier(batchId)) {
      sendJson(res, 400, { error: "Geçersiz paket kimliği" });
      return;
    }

    const batchDir = path.resolve(STORAGE_BAKED, batchId);
    if (!batchDir.startsWith(STORAGE_BAKED + path.sep)) {
      sendJson(res, 403, { error: "Yetkisiz erişim" });
      return;
    }

    const pkgJson = path.join(batchDir, "package.json");
    if (fs.existsSync(pkgJson)) {
      const data = JSON.parse(fs.readFileSync(pkgJson, "utf-8"));
      const hasVoiceover = fs.existsSync(path.join(batchDir, "voiceover.mp3"));
      sendJson(res, 200, { ...data, hasVoiceover });
      return;
    }
    sendJson(res, 404, { error: "Paket bulunamadı" });
    return;
  }

  // 7. API: TREND FİKİRLERİ BUL
  if (pathname === "/api/trends" && req.method === "GET") {
    const brandSlug = url.searchParams.get("brand")?.trim() || "";
    if (!brandSlug) {
      sendJson(res, 400, { error: "Marka seçilmedi." });
      return;
    }
    try {
      const { knowledge } = await BrandKnowledgeStore.resolveBrandForProduction(brandSlug);
      const ideas = await TrendAgent.discoverIdeas(knowledge, 3);
      sendJson(res, 200, { ideas });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 8. API: FIRINLA (MOD A: OTONOM TREND VEYA ÖZEL KONU)
  if (pathname === "/api/bake-topic" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const brandSlug = String(body.brandSlug || "").trim();
      if (!brandSlug) {
        sendJson(res, 400, { error: "Hedef marka seçilmelidir." });
        return;
      }

      const rawTopic = typeof body.topic === "string" ? body.topic.trim() : "";
      const customTopic = rawTopic.length > 0 ? rawTopic : undefined;

      const targetPlatforms = Array.isArray(body.platforms)
        ? (body.platforms.filter((p) =>
            TOPRAK_PLATFORMS.includes(p as ToprakPlatform)
          ) as ToprakPlatform[])
        : undefined;

      const pkg = await ToprakOrchestrator.bakeFromTrendTopic({
        brandSlug,
        customTopic,
        targetPlatforms,
        autoInject: true,
      });

      sendJson(res, 200, { success: true, package: pkg });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 9. API: TÜM SAĞLIKLI MARKALAR İÇİN OTONOM ÜRET VE ONAYA GÖNDER
  if (pathname === "/api/bake-all" && req.method === "POST") {
    try {
      const summary = await ToprakOrchestrator.bakeForAllHealthyBrands();
      sendJson(res, 200, { success: true, summary });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: msg });
    }
    return;
  }

  // 10. API: FIRINLA (MOD B: HAM VİDEO ENJEKSİYONU)
  if (pathname === "/api/bake-video" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const brandSlug = String(body.brandSlug || "").trim();
      const videoPath = String(body.videoPath || "").trim();

      if (!brandSlug) {
        sendJson(res, 400, { error: "Hedef marka seçilmelidir." });
        return;
      }
      if (!videoPath || !fs.existsSync(videoPath)) {
        sendJson(res, 400, { error: `Video dosyası bulunamadı: ${videoPath}` });
        return;
      }

      const pkg = await ToprakOrchestrator.bakeFromRawVideo({
        brandSlug,
        videoPath,
        autoInject: true,
      });

      sendJson(res, 200, { success: true, package: pkg });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 10b. API: GEMINI PRO WEB STÜDYO MODU DURUMU (KALICI SWITCH)
  if (pathname === "/api/studio-mode" && req.method === "GET") {
    sendJson(res, 200, readStudioState());
    return;
  }

  if (pathname === "/api/studio-mode" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const next = writeStudioState(Boolean(body.geminiWebMode));
      sendJson(res, 200, { ok: true, ...next });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { error: msg });
    }
    return;
  }

  // 10c. API: GEMINI PRO WEB STÜDYO — ADIM 1 (METİNLERİ VE VEO/GÖRSEL PROMPTLARINI HAZIRLA)
  if (pathname === "/api/studio/prepare" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const brandSlug = String(body.brandSlug || "").trim();
      if (!brandSlug) {
        sendJson(res, 400, { error: "Hedef marka seçilmelidir." });
        return;
      }

      const rawTopic = typeof body.topic === "string" ? body.topic.trim() : "";
      const customTopic = rawTopic.length > 0 ? rawTopic : undefined;
      const targetPlatforms = Array.isArray(body.platforms)
        ? (body.platforms.filter((p) =>
            TOPRAK_PLATFORMS.includes(p as ToprakPlatform)
          ) as ToprakPlatform[])
        : undefined;

      const draft = await ToprakOrchestrator.prepareGeminiStudioDraft({
        brandSlug,
        customTopic,
        targetPlatforms,
      });

      sendJson(res, 200, { success: true, draft });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 10d. API: GEMINI PRO WEB STÜDYO — İNDİRİLEN VİDEO/GÖRSEL DOSYASINI YÜKLE
  if (pathname === "/api/studio/upload" && req.method === "POST") {
    try {
      const batchId = (url.searchParams.get("batchId") || "").trim();
      const role = (url.searchParams.get("role") || "video").trim();
      const rawExt = (url.searchParams.get("ext") || "").trim().toLowerCase();

      const allowedExts =
        role === "image"
          ? [".png", ".jpg", ".jpeg", ".webp"]
          : [".mp4", ".mov", ".webm", ".mkv"];
      const safeExt = allowedExts.includes(rawExt)
        ? rawExt
        : role === "image"
        ? ".png"
        : ".mp4";

      let targetFilePath: string;
      if (batchId === "modb_raw") {
        targetFilePath = path.resolve(
          STORAGE_RAW,
          `modb_${Date.now()}${safeExt}`
        );
        if (!targetFilePath.startsWith(STORAGE_RAW + path.sep)) {
          sendJson(res, 403, { error: "Yetkisiz dosya konumu." });
          return;
        }
      } else {
        if (!isSafeIdentifier(batchId)) {
          sendJson(res, 400, { error: "Geçersiz taslak paket kimliği." });
          return;
        }
        const batchDir = path.resolve(STORAGE_BAKED, batchId);
        if (!batchDir.startsWith(STORAGE_BAKED + path.sep)) {
          sendJson(res, 403, { error: "Yetkisiz dizin erişimi." });
          return;
        }
        const fileName =
          role === "image"
            ? `gemini_pro_image${safeExt}`
            : `gemini_pro_video${safeExt}`;
        targetFilePath = path.join(batchDir, fileName);
      }

      const bytesWritten = await saveBinaryUpload(req, targetFilePath);
      if (bytesWritten < 256) {
        sendJson(res, 400, { error: "Yüklenen dosya boş veya geçersiz." });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        role,
        bytesWritten,
        localFilePath: targetFilePath,
        fileName: path.basename(targetFilePath),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 10e. API: GEMINI PRO WEB STÜDYO — ADIM 2 (KURUMSAL KİMLİK MONTAJI & SOCIAL KUYRUĞA AKTARIM)
  if (pathname === "/api/studio/finalize" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const batchId = String(body.batchId || "").trim();
      if (!isSafeIdentifier(batchId)) {
        sendJson(res, 400, { error: "Geçersiz taslak kimliği." });
        return;
      }

      const uploadedVideoPath =
        typeof body.uploadedVideoPath === "string" && body.uploadedVideoPath.trim()
          ? body.uploadedVideoPath.trim()
          : undefined;
      const uploadedImagePath =
        typeof body.uploadedImagePath === "string" && body.uploadedImagePath.trim()
          ? body.uploadedImagePath.trim()
          : undefined;
      const audioMode =
        body.audioMode === "ORIGINAL_VIDEO_AUDIO"
          ? "ORIGINAL_VIDEO_AUDIO"
          : "TOPRAK_TTS_MIX";

      const pkg = await ToprakOrchestrator.finalizeGeminiStudioDraft({
        batchId,
        uploadedVideoPath,
        uploadedImagePath,
        audioMode,
        autoInject: true,
      });

      sendJson(res, 200, { success: true, package: pkg });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, 422, { error: msg });
    }
    return;
  }

  // 11. ANA SAYFA: BAĞIMSIZ TOPRAK STÜDYO ARAYÜZÜ (:3333)
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderDashboardHtml());
    return;
  }

  res.writeHead(404);
  res.end("Sayfa bulunamadı");
});

function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="tr" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Toprak — Otonom İçerik Fırını</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b0f19; color: #f1f5f9; font-family: system-ui, -apple-system, sans-serif; }
    .glass { background: rgba(17, 24, 39, 0.72); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); }
    .glass-card { background: rgba(30, 41, 59, 0.52); border: 1px solid rgba(255, 255, 255, 0.07); }
    .active-tab { border-bottom: 2px solid #38bdf8; color: #38bdf8; font-weight: 600; }
    .drop-active { border-color: #38bdf8 !important; background: rgba(56, 189, 248, 0.12) !important; }
  </style>
</head>
<body class="min-h-screen flex flex-col">
  <header class="glass sticky top-0 z-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
    <div class="flex items-center space-x-3">
      <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-indigo-500 flex items-center justify-center text-xl shadow-lg shadow-amber-500/20">
        🌾
      </div>
      <div>
        <h1 class="text-xl font-bold bg-gradient-to-r from-amber-300 via-rose-300 to-sky-300 bg-clip-text text-transparent">
          TOPRAK
        </h1>
        <p class="text-xs text-slate-400">Bağımsız Otonom İçerik Motoru • Onay Yeri: Lappsoft Social</p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2.5">
      <!-- Kalıcı Gemini Pro Web Modu Switch -->
      <div id="geminiSwitchWrap" class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900/80 transition">
        <button type="button" id="geminiModeToggle" onclick="toggleGeminiWebMode()" role="switch" aria-checked="false" class="flex items-center gap-2.5 focus:outline-none">
          <span class="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <i class="fa-solid fa-wand-magic-sparkles text-sky-400"></i>
            <span>Gemini Pro Web</span>
          </span>
          <span id="geminiSwitchTrack" class="relative inline-flex h-5 w-10 items-center rounded-full bg-slate-700 transition-colors duration-200">
            <span id="geminiSwitchThumb" class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 translate-x-1"></span>
          </span>
          <span id="geminiSwitchBadge" class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">KAPALI</span>
        </button>
        <button type="button" id="btnOpenGeminiWin" onclick="openGeminiProWindow()" class="hidden pl-2 border-l border-slate-700 text-[11px] font-bold text-sky-300 hover:text-sky-200 transition flex items-center gap-1" title="Gemini Pro oturum penceresini aç veya öne getir">
          <span>Gemini'yi Aç</span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
        </button>
      </div>

      <button onclick="bakeAllBrands()" id="btnBakeAll" class="px-3.5 py-1.5 text-xs font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl transition flex items-center space-x-1.5">
        <i class="fa-solid fa-layer-group"></i>
        <span>Tüm Sağlıklı Markalara Üret</span>
      </button>
      <a id="socialQueueLink" href="http://localhost:3000/queue" target="_blank" rel="noreferrer" class="px-3.5 py-1.5 text-xs font-bold bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 border border-emerald-500/40 rounded-xl transition flex items-center space-x-1.5">
        <i class="fa-solid fa-check-double"></i>
        <span>Social Onay Kuyruğu (:3000)</span>
      </a>
      <button onclick="refreshData()" class="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition flex items-center space-x-1.5 border border-slate-700">
        <i class="fa-solid fa-arrows-rotate"></i>
        <span>Yenile</span>
      </button>
    </div>
  </header>

  <main class="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
    <!-- Canlı Social Marka Şeridi -->
    <div class="glass p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Social Markaları:</span>
        <div id="brandPills" class="flex flex-wrap gap-2"></div>
      </div>
      <div id="brandMeta" class="text-xs text-slate-400"></div>
    </div>

    <!-- Sekmeler -->
    <div class="flex space-x-8 border-b border-slate-800 text-sm">
      <button onclick="switchTab('mod-a')" id="tab-mod-a" class="pb-3 active-tab transition flex items-center space-x-2">
        <i class="fa-solid fa-lightbulb text-amber-400"></i>
        <span>Mod A: Otonom Trend & Konsept Fırını</span>
      </button>
      <button onclick="switchTab('mod-b')" id="tab-mod-b" class="pb-3 text-slate-400 hover:text-slate-200 transition flex items-center space-x-2">
        <i class="fa-solid fa-video text-rose-400"></i>
        <span>Mod B: Ham Video Enjeksiyonu</span>
      </button>
      <button onclick="switchTab('gallery')" id="tab-gallery" class="pb-3 text-slate-400 hover:text-slate-200 transition flex items-center space-x-2">
        <i class="fa-solid fa-bread-slice text-amber-400"></i>
        <span>Fırından Çıkanlar (<span id="bakedCount">0</span>)</span>
      </button>
    </div>

    <!-- TAB 1: MOD A -->
    <section id="panel-mod-a" class="space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="glass p-6 rounded-2xl space-y-5 lg:col-span-2">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold text-slate-100 flex items-center space-x-2">
              <i class="fa-solid fa-wand-magic-sparkles text-amber-400"></i>
              <span>İçerik Üretimi (Onay Bekliyor Olarak Social'a Düşer)</span>
            </h2>
            <button onclick="fetchTrendIdeas()" id="btnTrends" class="text-xs bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 px-3 py-1.5 rounded-lg transition flex items-center space-x-1.5">
              <i class="fa-solid fa-bolt"></i>
              <span>AI Trendleri Tara</span>
            </button>
          </div>

          <!-- Gemini Pro Web Modu Aktif Bilgi Şeridi -->
          <div id="geminiModeBanner" class="hidden p-3.5 rounded-xl bg-sky-950/50 border border-sky-500/40 text-xs text-sky-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1">
              <p class="font-bold text-sky-300 flex items-center gap-1.5">
                <i class="fa-solid fa-sparkles"></i>
                <span>✨ Gemini Pro Web Stüdyo Modu Aktif (API Maliyeti Yok)</span>
              </p>
              <p class="text-slate-300 leading-relaxed">
                <b>1. Adımda</b> tüm platform metinleri, X slaytları ve hazır <b>Veo Video / Görsel promptları</b> üretilir. <b>2. Adımda</b> açık Gemini Pro pencerenizden indirdiğiniz videoyu/görseli sürükleyip bırakın; Toprak kurumsal logoyu, Türkçe seslendirmeyi ve kapanış kartını basıp Social kuyruğuna gönderir.
              </p>
            </div>
            <button type="button" onclick="openGeminiProWindow()" class="shrink-0 px-3 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-bold text-xs transition">
              Gemini Pro Penceresi ↗
            </button>
          </div>

          <div id="unhealthyBanner" class="hidden p-3.5 rounded-xl bg-rose-950/60 border border-rose-700/60 text-xs text-rose-200">
            Bu markanın Lappsoft Social üzerinde bağlı ve <b>HEALTHY</b> durumda hiçbir sosyal medya hesabı yok. Önce Social üzerinden hesap bağlayın.
          </div>

          <div id="trendIdeasContainer" class="hidden space-y-2 p-3 rounded-xl bg-slate-900/60 border border-indigo-500/20">
            <p class="text-xs font-semibold text-indigo-400">Önerilen Trend Kancaları (Tıklayarak Seçin):</p>
            <div id="trendList" class="space-y-2"></div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-amber-300 mb-1.5">
              Konsept / Fikir Metni <span class="text-slate-400 font-normal">(Boş bırakırsanız Trend Ajanı konuyu otonom belirler)</span>
            </label>
            <textarea id="topicInput" rows="3" class="w-full bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-sm focus:outline-none focus:border-amber-400 text-slate-100" placeholder="İsterseniz özel bir konu yazın veya boş bırakıp doğrudan fırına verin..."></textarea>
          </div>

          <div>
            <label class="block text-xs font-medium text-slate-400 mb-2">
              Markanın Bağlı ve Sağlıklı (HEALTHY) Platformları
            </label>
            <div id="platformCheckboxes" class="flex flex-wrap gap-2"></div>
          </div>

          <button onclick="bakeTopic()" id="btnBakeTopic" class="w-full py-3.5 px-4 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-600 hover:opacity-90 disabled:opacity-40 font-bold text-white rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center space-x-2">
            <i class="fa-solid fa-fire-burner"></i>
            <span>Üret ve Social 'Onay Bekliyor' Kuyruğuna Gönder</span>
          </button>
        </div>

        <!-- Sağ: Merkezi AI Hub & Sistem Özeti -->
        <div class="glass p-6 rounded-2xl space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-200 flex items-center space-x-2">
              <i class="fa-solid fa-microchip text-sky-400"></i>
              <span>Merkezi AI Hub & Ajanlar</span>
            </h3>
            <button onclick="syncLearning()" id="btnLearnSync" class="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700">
              Öğrenmeyi Yenile
            </button>
          </div>
          <div id="hubStatusBox" class="text-xs text-slate-400 space-y-2">Yükleniyor...</div>
          <div class="pt-3 border-t border-slate-800 text-xs text-slate-400 space-y-2">
            <p class="flex items-start space-x-2">
              <i class="fa-solid fa-check text-emerald-400 mt-0.5"></i>
              <span>Yalnızca Social'dan gelen <b>HEALTHY</b> platformlar için o platforma özgü içerik üretilir.</span>
            </p>
            <p class="flex items-start space-x-2">
              <i class="fa-solid fa-check text-emerald-400 mt-0.5"></i>
              <span>Toprak asla otomatik paylaşım yapmaz; tüm paketler Social'da <b>ONAY BEKLİYOR</b> olarak bekler.</span>
            </p>
          </div>
        </div>
      </div>

      <!-- GEMINI PRO WEB STÜDYO: ADIM 2 PANELİ (PROMPT KOPYALA + VİDEO/GÖRSEL SÜRÜKLE BIRAK + FİNALİZE) -->
      <div id="geminiStudioPanel" class="hidden glass p-6 rounded-2xl border border-sky-500/40 space-y-6 shadow-xl shadow-sky-950/30">
        <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40">
                ✨ Gemini Pro Stüdyo Taslağı Hazır
              </span>
              <span id="studioDraftBrand" class="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800"></span>
              <span id="studioDraftScenario" class="hidden px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30"></span>
              <span id="studioDraftScore" class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"></span>
            </div>
            <h3 id="studioDraftTitle" class="text-lg font-bold text-slate-100 pt-1"></h3>
            <p class="text-xs text-slate-400">
              🎙️ <b>Türkçe Seslendirme Senaryosu:</b> <span id="studioVoicePreview" class="text-slate-200 italic"></span>
            </p>
          </div>
          <button type="button" onclick="openGeminiProWindow()" class="px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold shadow-md transition flex items-center gap-2">
            <i class="fa-solid fa-up-right-from-square"></i>
            <span>Gemini Pro Penceresini Aç / Öne Getir</span>
          </button>
        </div>

        <!-- Hazır Gemini Pro Prompt Kutuları -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <!-- Kutu 1: Veo 9:16 Video Promptu -->
          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-film"></i>
                  <span>1A. Gemini Pro (Veo 9:16 Dikey Video) Promptu</span>
                </span>
                <button type="button" onclick="copyStudioPrompt('studioVideoPromptText', this)" class="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-bold transition flex items-center gap-1.5">
                  <i class="fa-regular fa-copy"></i>
                  <span>Kopyala & Gemini'ye Geç ↗</span>
                </button>
              </div>
              <textarea id="studioVideoPromptText" rows="5" class="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-400"></textarea>
            </div>
            <p class="text-[11px] text-slate-400">
              İpucu: Gemini Pro'da bu metni yapıştırıp videoyu oluşturduktan sonra sağ üstteki <b>İndir (.mp4)</b> butonuna basın ve aşağıdaki kutuya bırakın.
            </p>
          </div>

          <!-- Kutu 2: Imagen / Nano Banana 9:16 Görsel Promptu -->
          <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <i class="fa-solid fa-image"></i>
                  <span>1B. Gemini Pro (9:16 Görsel / Poster) Promptu</span>
                </span>
                <button type="button" onclick="copyStudioPrompt('studioImagePromptText', this)" class="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold transition flex items-center gap-1.5">
                  <i class="fa-regular fa-copy"></i>
                  <span>Kopyala & Gemini'ye Geç ↗</span>
                </button>
              </div>
              <textarea id="studioImagePromptText" rows="5" class="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-400"></textarea>
            </div>
            <p class="text-[11px] text-slate-400">
              İpucu: Video yükleyecekseniz ayrıca görsel yüklemeniz <b>zorunlu değildir</b> (Toprak kapak fotoğrafını videodan otomatik çıkarır). Sadece görselli Reels üretmek için görsel de yükleyebilirsiniz.
            </p>
          </div>
        </div>

        <!-- Sürükle & Bırak Medya Yükleme Alanları -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <!-- Video Drop Zone -->
          <div id="videoDropZone"
               onclick="document.getElementById('studioVideoFileInput').click()"
               ondragover="handleDragOver(event, this)"
               ondragleave="handleDragLeave(event, this)"
               ondrop="handleStudioDrop(event, 'video', this)"
               class="p-5 rounded-xl border-2 border-dashed border-slate-700 hover:border-rose-400/70 bg-slate-900/60 cursor-pointer transition flex flex-col items-center justify-center text-center space-y-2 min-h-[148px]">
            <input type="file" id="studioVideoFileInput" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" class="hidden" onchange="handleStudioFileSelect(this, 'video')">
            <div class="w-10 h-10 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center text-lg">
              <i class="fa-solid fa-cloud-arrow-up"></i>
            </div>
            <p class="text-xs font-bold text-slate-200">🎬 İndirdiğiniz Gemini Pro Videosunu (.mp4) Buraya Sürükleyin veya Tıklayın</p>
            <p id="studioVideoUploadStatus" class="text-[11px] text-slate-400">Henüz video seçilmedi.</p>
          </div>

          <!-- Image Drop Zone -->
          <div id="imageDropZone"
               onclick="document.getElementById('studioImageFileInput').click()"
               ondragover="handleDragOver(event, this)"
               ondragleave="handleDragLeave(event, this)"
               ondrop="handleStudioDrop(event, 'image', this)"
               class="p-5 rounded-xl border-2 border-dashed border-slate-700 hover:border-amber-400/70 bg-slate-900/60 cursor-pointer transition flex flex-col items-center justify-center text-center space-y-2 min-h-[148px]">
            <input type="file" id="studioImageFileInput" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" class="hidden" onchange="handleStudioFileSelect(this, 'image')">
            <div class="w-10 h-10 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-lg">
              <i class="fa-solid fa-file-image"></i>
            </div>
            <p class="text-xs font-bold text-slate-200">🖼️ Gemini Pro Görselini (.png / .jpg) Sürükleyin veya Tıklayın <span class="text-slate-400 font-normal">(İsteğe Bağlı)</span></p>
            <p id="studioImageUploadStatus" class="text-[11px] text-slate-400">Video yüklendiyse boş bırakabilirsiniz (kapak videodan üretilir).</p>
          </div>
        </div>

        <!-- Ses Modu & Finalize Aksiyonu -->
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div class="lg:col-span-2">
              <label class="block text-xs font-bold text-slate-300 mb-1.5">
                🎙️ Seslendirme & Kurumsal Kurgu Tercihi
              </label>
              <select id="studioAudioMode" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-sky-400">
                <option value="TOPRAK_TTS_MIX">🎙️ Toprak Türkçe Seslendirme (AI→A-İ, ~148 WPM Duygulu Ses) + Türkçe Altyazı + Kurumsal Logo & Kapanış Kartı (Önerilen)</option>
                <option value="ORIGINAL_VIDEO_AUDIO">🔊 Gemini Pro Videosunun Kendi Orijinal Sesini Koru (Sadece Kurumsal Logo, Alt Bant & Kapanış Kartı Bas)</option>
              </select>
            </div>
            <div class="text-[11px] text-slate-400 leading-relaxed">
              Her iki seçenekte de markanın vektörel logosu, orta alt bantı ve <b>modenamoda.com.tr</b> / <b>lappsoft.com</b> kapanış kartı otomatik basılır.
            </div>
          </div>

          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button type="button" id="btnFinalizeStudio" onclick="finalizeGeminiStudio(false)" class="flex-1 py-3.5 px-5 bg-gradient-to-r from-emerald-500 via-teal-500 to-sky-600 hover:opacity-95 disabled:opacity-40 font-bold text-white rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 text-sm">
              <i class="fa-solid fa-stamp"></i>
              <span>2. Adım: Kurumsal Kimlik Bas & Social 'Onay Bekliyor' Kuyruğuna Gönder</span>
            </button>
            <button type="button" id="btnFinalizeFallback" onclick="finalizeGeminiStudio(true)" class="py-3.5 px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition">
              Medya Yüklemeden Tamamla
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- TAB 2: MOD B -->
    <section id="panel-mod-b" class="hidden space-y-6">
      <div class="glass p-6 rounded-2xl space-y-5 max-w-3xl mx-auto">
        <div class="border-b border-slate-800 pb-4">
          <h2 class="text-lg font-bold text-slate-100 flex items-center space-x-2">
            <i class="fa-solid fa-clapperboard text-rose-400"></i>
            <span>Ham Video Enjeksiyonu (Mod B)</span>
          </h2>
          <p class="text-xs text-slate-400 mt-1">Ham videonuzun sesini Merkezi AI Hub (Whisper) ile çözer, Türkçe altyazı basar, 9:16 dikey kurgulayıp sağlıklı platformlar için Social 'Onay Bekliyor' kuyruğuna düşürür.</p>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-medium text-slate-400">Video Dosyası Seçin veya Tam Yol Girin</label>
            <button type="button" onclick="document.getElementById('modBFileInput').click()" class="text-xs px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-semibold transition">
              <i class="fa-solid fa-folder-open mr-1"></i>Bilgisayardan Video Seç (.mp4)
            </button>
            <input type="file" id="modBFileInput" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" class="hidden" onchange="uploadModBVideo(this)">
          </div>
          <input type="text" id="videoPathInput" class="w-full bg-slate-900/90 border border-slate-700 rounded-xl p-3 text-sm focus:outline-none focus:border-rose-400 text-slate-100" placeholder="Örn: C:\\Users\\pc\\Videos\\ham_kayit.mp4">
        </div>

        <button onclick="bakeVideo()" id="btnBakeVideo" class="w-full py-3.5 px-4 bg-gradient-to-r from-rose-500 to-indigo-600 hover:opacity-90 disabled:opacity-40 font-bold text-white rounded-xl shadow-lg shadow-rose-500/20 transition flex items-center justify-center space-x-2">
          <i class="fa-solid fa-film"></i>
          <span>Videoyu Kurgula ve Social Onayına Gönder</span>
        </button>
      </div>
    </section>

    <!-- TAB 3: GALERİ -->
    <section id="panel-gallery" class="hidden space-y-6">
      <div id="galleryList" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
      <div id="galleryEmpty" class="hidden text-center py-16 text-slate-500 glass rounded-2xl">
        <i class="fa-solid fa-bread-slice text-4xl mb-3 text-slate-600"></i>
        <p>Henüz fırından çıkmış bir içerik paketi yok.</p>
      </div>
    </section>

    <!-- Detay Modalı -->
    <div id="detailModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4" onclick="closeModal()">
      <div class="glass max-w-4xl w-full max-h-[90vh] rounded-2xl flex flex-col overflow-hidden border border-slate-700" onclick="event.stopPropagation()">
        <div class="p-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 id="modalTitle" class="text-base font-bold text-slate-100">İçerik Paketi Detayı</h3>
            <p id="modalSubtitle" class="text-xs text-slate-400"></p>
          </div>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white p-2 text-lg">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div id="modalContent" class="p-6 overflow-y-auto space-y-6 flex-1 text-sm"></div>
      </div>
    </div>
  </main>

  <script>
    let currentBrand = '';
    let allBrands = [];
    let socialQueueUrl = 'http://localhost:3000/queue';
    let geminiWebMode = false;
    let geminiWindowRef = null;
    let activeStudioDraft = null;
    let studioUploadedVideoPath = '';
    let studioUploadedImagePath = '';

    function esc(val) {
      return String(val ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function init() {
      await loadStudioMode();
      await Promise.all([loadBrands(), loadHubStatus(), loadPackages()]);
    }

    async function loadStudioMode() {
      try {
        const res = await fetch('/api/studio-mode');
        const data = await res.json();
        geminiWebMode = Boolean(data.geminiWebMode);
        applyGeminiModeUi();
      } catch (err) {
        console.error('Stüdyo modu okunamadı', err);
      }
    }

    function openGeminiProWindow() {
      try {
        geminiWindowRef = window.open(
          'https://gemini.google.com/app',
          'toprak_gemini_pro_window',
          'width=1260,height=880,menubar=no,toolbar=yes,location=yes,status=yes,resizable=yes,scrollbars=yes'
        );
        if (geminiWindowRef) {
          geminiWindowRef.focus();
        }
      } catch (err) {
        console.warn('Gemini Pro penceresi açılamadı:', err);
      }
    }

    async function toggleGeminiWebMode() {
      const nextState = !geminiWebMode;
      // Tarayıcı popup engelleyicisine takılmamak için ON konumuna geçerken pencereyi tıklama anında senkron açıyoruz:
      if (nextState) {
        openGeminiProWindow();
      }
      geminiWebMode = nextState;
      applyGeminiModeUi();
      loadHubStatus();

      try {
        await fetch('/api/studio-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geminiWebMode: nextState })
        });
      } catch (err) {
        console.error('Switch durumu kaydedilemedi:', err);
      }
    }

    function applyGeminiModeUi() {
      const wrap = document.getElementById('geminiSwitchWrap');
      const toggleBtn = document.getElementById('geminiModeToggle');
      const track = document.getElementById('geminiSwitchTrack');
      const thumb = document.getElementById('geminiSwitchThumb');
      const badge = document.getElementById('geminiSwitchBadge');
      const openWinBtn = document.getElementById('btnOpenGeminiWin');
      const banner = document.getElementById('geminiModeBanner');
      const studioPanel = document.getElementById('geminiStudioPanel');
      const btnBakeTopic = document.getElementById('btnBakeTopic');

      toggleBtn.setAttribute('aria-checked', geminiWebMode ? 'true' : 'false');

      if (geminiWebMode) {
        wrap.className = 'flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-sky-500/60 bg-sky-950/60 shadow-md shadow-sky-500/10 transition';
        track.className = 'relative inline-flex h-5 w-10 items-center rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 transition-colors duration-200';
        thumb.className = 'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 translate-x-5';
        badge.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        badge.innerText = 'AKTİF';
        openWinBtn.classList.remove('hidden');
        banner.classList.remove('hidden');
        btnBakeTopic.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> <span>1. Adım: Metinleri & Gemini Pro (Veo/Görsel) Promptlarını Hazırla</span>';
        if (activeStudioDraft) {
          studioPanel.classList.remove('hidden');
        }
      } else {
        wrap.className = 'flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-700 bg-slate-900/80 transition';
        track.className = 'relative inline-flex h-5 w-10 items-center rounded-full bg-slate-700 transition-colors duration-200';
        thumb.className = 'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 translate-x-1';
        badge.className = 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700';
        badge.innerText = 'KAPALI';
        openWinBtn.classList.add('hidden');
        banner.classList.add('hidden');
        studioPanel.classList.add('hidden');
        btnBakeTopic.innerHTML = '<i class="fa-solid fa-fire-burner"></i> <span>Üret ve Social \\'Onay Bekliyor\\' Kuyruğuna Gönder</span>';
      }
    }

    async function loadHubStatus() {
      try {
        const res = await fetch('/api/hub-status');
        const data = await res.json();
        const box = document.getElementById('hubStatusBox');
        const entries = Object.entries(data.agentPrimaryModels || {});
        const cs = data.castSummary || {};
        const sp = data.scenarioPoolSummary || {};
        const castDetail = cs.femaleTesettur
          ? \`\${esc(data.castCount)} model (\${esc(cs.femaleStandard)} Açık • \${esc(cs.femaleTesettur)} Tesettür • \${esc(cs.male)} Erkek)\`
          : \`\${esc(data.castCount)} aktif dijital model\`;
        const scenarioDetail = sp.modenaCount
          ? \`\${esc(sp.modenaCount)} gerçek yaşam etkinliği (Düğün, Spor, Plaza, Günlük...)\`
          : '';
        const modeBanner = geminiWebMode
          ? \`<div class="p-2.5 rounded-xl bg-sky-950/70 border border-sky-500/40 text-sky-200 space-y-1">
               <div><span class="font-bold text-sky-300">✨ Medya Motoru:</span> Gemini Pro Web Oturumu (Veo + Görsel)</div>
               <div class="text-[11px] text-slate-300"><span class="font-semibold">Cast Kurra:</span> \${castDetail}</div>
               \${scenarioDetail ? \`<div class="text-[11px] text-amber-300/90"><span class="font-semibold">Sahne Kurra:</span> \${scenarioDetail}</div>\` : ''}
             </div>\`
          : \`<div class="p-2.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-1">
               <div><span class="text-slate-300 font-semibold">Cast Kurra:</span> \${castDetail}</div>
               \${scenarioDetail ? \`<div class="text-[11px] text-amber-300/90"><span class="font-semibold">Sahne Kurra:</span> \${scenarioDetail}</div>\` : ''}
             </div>\`;
        box.innerHTML = \`
          \${modeBanner}
          <div class="space-y-1">
            \${entries.map(([role, model]) => \`
              <div class="flex items-center justify-between text-[11px] bg-slate-900/50 px-2.5 py-1 rounded border border-slate-800/70">
                <span class="font-semibold text-slate-300">\${esc(role)}</span>
                <span class="font-mono text-sky-400">\${esc(
                  geminiWebMode && (role === 'IMAGE_GEN' || role === 'VIDEO_GEN')
                    ? 'gemini.google.com (Pro Web)'
                    : model
                )}</span>
              </div>
            \`).join('')}
          </div>
        \`;
      } catch (e) {
        console.error(e);
      }
    }

    async function loadBrands() {
      try {
        const res = await fetch('/api/brands');
        const data = await res.json();
        allBrands = data.brands || [];
        if (data.socialQueueUrl) {
          socialQueueUrl = data.socialQueueUrl;
          document.getElementById('socialQueueLink').href = socialQueueUrl;
        }
        if (!currentBrand && allBrands.length > 0) {
          const firstHealthy = allBrands.find(b => b.isQualified);
          currentBrand = firstHealthy ? firstHealthy.slug : allBrands[0].slug;
        }
        renderBrandPills();
      } catch (err) {
        console.error('Markalar yüklenemedi', err);
      }
    }

    function renderBrandPills() {
      const container = document.getElementById('brandPills');
      container.innerHTML = allBrands.map(b => {
        const active = b.slug === currentBrand;
        const badge = b.healthyPlatforms.length > 0
          ? \`<span class="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">\${b.healthyPlatforms.length} HEALTHY</span>\`
          : \`<span class="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 text-[10px]">0 Bağlı</span>\`;
        return \`<button data-slug="\${esc(b.slug)}" onclick="selectBrand(this.dataset.slug)" class="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center space-x-2 \${active ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-md' : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'}">
          <span>\${esc(b.name)}</span>
          \${badge}
        </button>\`;
      }).join('');
      updateBrandState();
    }

    function selectBrand(slug) {
      currentBrand = slug;
      document.getElementById('trendIdeasContainer').classList.add('hidden');
      renderBrandPills();
    }

    function updateBrandState() {
      const brand = allBrands.find(b => b.slug === currentBrand);
      const platformBox = document.getElementById('platformCheckboxes');
      const unhealthyBanner = document.getElementById('unhealthyBanner');
      const btnBakeTopic = document.getElementById('btnBakeTopic');
      const btnBakeVideo = document.getElementById('btnBakeVideo');
      const btnTrends = document.getElementById('btnTrends');

      if (!brand) return;

      document.getElementById('brandMeta').innerText =
        \`Sektör: \${brand.sector} • Öğrenilen Gönderi: \${brand.analyzedPosts}\`;

      if (brand.healthyPlatforms.length === 0) {
        unhealthyBanner.classList.remove('hidden');
        btnBakeTopic.disabled = true;
        btnBakeVideo.disabled = true;
        btnTrends.disabled = true;
        platformBox.innerHTML = '<span class="text-xs text-slate-500 italic">Sağlıklı platform bulunmuyor.</span>';
      } else {
        unhealthyBanner.classList.add('hidden');
        btnBakeTopic.disabled = false;
        btnBakeVideo.disabled = false;
        btnTrends.disabled = false;
        platformBox.innerHTML = brand.healthyPlatforms.map(p => \`
          <label class="flex items-center space-x-2 text-xs bg-slate-800/80 px-3 py-2 rounded-lg cursor-pointer border border-emerald-700/40">
            <input type="checkbox" name="platform" value="\${esc(p)}" checked class="rounded text-amber-500">
            <span class="uppercase font-semibold text-emerald-300">\${esc(p)}</span>
          </label>
        \`).join('');
      }
    }

    function switchTab(tabId) {
      ['mod-a', 'mod-b', 'gallery'].forEach(t => {
        document.getElementById('panel-' + t).classList.add('hidden');
        document.getElementById('tab-' + t).classList.remove('active-tab');
        document.getElementById('tab-' + t).classList.add('text-slate-400');
      });
      document.getElementById('panel-' + tabId).classList.remove('hidden');
      document.getElementById('tab-' + tabId).classList.add('active-tab');
      document.getElementById('tab-' + tabId).classList.remove('text-slate-400');

      if (tabId === 'gallery') loadPackages();
    }

    async function fetchTrendIdeas() {
      const btn = document.getElementById('btnTrends');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Aranıyor...';
      try {
        const res = await fetch('/api/trends?brand=' + encodeURIComponent(currentBrand));
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const list = document.getElementById('trendList');
        list.innerHTML = (data.ideas || []).map(i => {
          const combined = i.headline + ': ' + i.angleDescription;
          return \`<div data-idea="\${esc(combined)}" onclick="document.getElementById('topicInput').value = this.dataset.idea" class="p-2.5 bg-slate-800/70 hover:bg-slate-700 rounded-lg cursor-pointer text-xs transition border border-slate-700/60">
            <p class="font-bold text-slate-200">\${esc(i.headline)}</p>
            <p class="text-slate-400 text-[11px] mt-0.5">\${esc(i.hook)}</p>
          </div>\`;
        }).join('');
        document.getElementById('trendIdeasContainer').classList.remove('hidden');
      } catch (err) {
        alert('Trend araması başarısız: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> <span>AI Trendleri Tara</span>';
      }
    }

    async function bakeTopic() {
      if (geminiWebMode) {
        await prepareGeminiStudio();
        return;
      }

      const topic = document.getElementById('topicInput').value.trim();
      const platforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(c => c.value);
      if (platforms.length === 0) {
        alert('En az 1 sağlıklı platform seçmelisiniz.');
        return;
      }

      const btn = document.getElementById('btnBakeTopic');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Ajanlar Çalışıyor (Trend -> Yazar -> Cast/Prompt -> Denetçi -> Medya -> Social Onay Kuyruğu)...';

      try {
        const res = await fetch('/api/bake-topic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandSlug: currentBrand, topic, platforms })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        alert('🎉 İçerik üretildi ve Lappsoft Social Onay Kuyruğuna (ONAY BEKLİYOR) bırakıldı! Skor: ' + data.package.validation.overallScore + '/100');
        switchTab('gallery');
      } catch (err) {
        alert('Üretim hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        applyGeminiModeUi();
      }
    }

    async function prepareGeminiStudio() {
      const topic = document.getElementById('topicInput').value.trim();
      const platforms = Array.from(document.querySelectorAll('input[name="platform"]:checked')).map(c => c.value);
      if (platforms.length === 0) {
        alert('En az 1 sağlıklı platform seçmelisiniz.');
        return;
      }

      const btn = document.getElementById('btnBakeTopic');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> 1. Adım: Metinler, X Slaytları ve Gemini Pro (Veo/Görsel) Promptları Hazırlanıyor...';

      try {
        const res = await fetch('/api/studio/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandSlug: currentBrand, topic, platforms })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        activeStudioDraft = data.draft;
        studioUploadedVideoPath = '';
        studioUploadedImagePath = '';

        document.getElementById('studioDraftBrand').innerText = activeStudioDraft.brandName;
        const scenEl = document.getElementById('studioDraftScenario');
        if (activeStudioDraft.scenarioTitle) {
          scenEl.innerText = '🎬 ' + activeStudioDraft.scenarioTitle;
          scenEl.classList.remove('hidden');
        } else {
          scenEl.innerText = '';
          scenEl.classList.add('hidden');
        }
        document.getElementById('studioDraftScore').innerText = 'Kalite Skoru: ' + activeStudioDraft.validationScore + '/100';
        document.getElementById('studioDraftTitle').innerText = activeStudioDraft.topic;
        document.getElementById('studioVoicePreview').innerText = activeStudioDraft.voiceoverPreviewText || '';
        document.getElementById('studioVideoPromptText').value = activeStudioDraft.geminiProVideoPrompt || '';
        document.getElementById('studioImagePromptText').value = activeStudioDraft.geminiProImagePrompt || '';
        document.getElementById('studioVideoUploadStatus').innerHTML = '<span class="text-slate-400">Henüz video seçilmedi.</span>';
        document.getElementById('studioImageUploadStatus').innerHTML = '<span class="text-slate-400">Video yüklendiyse boş bırakabilirsiniz (kapak videodan üretilir).</span>';
        document.getElementById('studioVideoFileInput').value = '';
        document.getElementById('studioImageFileInput').value = '';

        const panel = document.getElementById('geminiStudioPanel');
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        alert('Gemini Pro taslak hazırlama hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        applyGeminiModeUi();
      }
    }

    function copyStudioPrompt(textareaId, btn) {
      const text = document.getElementById(textareaId).value || '';
      navigator.clipboard.writeText(text);
      openGeminiProWindow();
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check text-emerald-300"></i> <span>Kopyalandı! Gemini Pro\\'ya Yapıştırın</span>';
      setTimeout(() => { btn.innerHTML = orig; }, 2600);
    }

    function handleDragOver(e, el) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop-active');
    }

    function handleDragLeave(e, el) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-active');
    }

    async function handleStudioDrop(e, role, el) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-active');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        await uploadStudioFile(files[0], role);
      }
    }

    async function handleStudioFileSelect(input, role) {
      if (input.files && input.files.length > 0) {
        await uploadStudioFile(input.files[0], role);
      }
    }

    function getFileExt(name) {
      const idx = String(name || '').lastIndexOf('.');
      return idx >= 0 ? String(name).slice(idx).toLowerCase() : '';
    }

    async function uploadStudioFile(file, role) {
      if (!activeStudioDraft || !activeStudioDraft.batchId) {
        alert('Önce 1. Adım ile Gemini Pro taslağını hazırlayın.');
        return;
      }
      const statusEl = document.getElementById(
        role === 'video' ? 'studioVideoUploadStatus' : 'studioImageUploadStatus'
      );
      statusEl.innerHTML = '<span class="text-sky-300 font-semibold"><i class="fa-solid fa-spinner animate-spin mr-1"></i>Yükleniyor: ' + esc(file.name) + '...</span>';

      try {
        const ext = getFileExt(file.name);
        const url = '/api/studio/upload?batchId=' + encodeURIComponent(activeStudioDraft.batchId) +
          '&role=' + encodeURIComponent(role) +
          '&ext=' + encodeURIComponent(ext);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const sizeMb = (Number(data.bytesWritten || file.size) / (1024 * 1024)).toFixed(2);
        if (role === 'video') {
          studioUploadedVideoPath = data.localFilePath;
        } else {
          studioUploadedImagePath = data.localFilePath;
        }
        statusEl.innerHTML = '<span class="text-emerald-300 font-bold"><i class="fa-solid fa-circle-check mr-1"></i>Hazır: ' + esc(file.name) + ' (' + sizeMb + ' MB)</span>';
      } catch (err) {
        statusEl.innerHTML = '<span class="text-rose-400 font-semibold">Yükleme hatası: ' + esc(err.message) + '</span>';
      }
    }

    async function finalizeGeminiStudio(allowWithoutMedia) {
      if (!activeStudioDraft || !activeStudioDraft.batchId) {
        alert('Aktif bir stüdyo taslağı bulunamadı.');
        return;
      }

      if (!allowWithoutMedia && !studioUploadedVideoPath && !studioUploadedImagePath) {
        const proceed = confirm(
          'Henüz Gemini Pro\\'dan indirdiğiniz bir video (.mp4) veya görsel (.png/.jpg) seçmediniz.\\n\\nMedya yüklemeden otomatik görselle tamamlamak ister misiniz?'
        );
        if (!proceed) return;
      }

      const btn = document.getElementById('btnFinalizeStudio');
      const btnFallback = document.getElementById('btnFinalizeFallback');
      const audioMode = document.getElementById('studioAudioMode').value;

      btn.disabled = true;
      btnFallback.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Kurumsal Logo, Türkçe Seslendirme, Altyazı ve Kapanış Kartı Basılıyor...';

      try {
        const res = await fetch('/api/studio/finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchId: activeStudioDraft.batchId,
            uploadedVideoPath: studioUploadedVideoPath || undefined,
            uploadedImagePath: studioUploadedImagePath || undefined,
            audioMode
          })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        activeStudioDraft = null;
        studioUploadedVideoPath = '';
        studioUploadedImagePath = '';
        document.getElementById('geminiStudioPanel').classList.add('hidden');

        alert('🎉 Gemini Pro medyanıza kurumsal kimlik basıldı ve Lappsoft Social Onay Kuyruğuna (ONAY BEKLİYOR) gönderildi!');
        switchTab('gallery');
      } catch (err) {
        alert('Kurumsal montaj hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        btnFallback.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-stamp"></i> <span>2. Adım: Kurumsal Kimlik Bas & Social \\'Onay Bekliyor\\' Kuyruğuna Gönder</span>';
      }
    }

    async function uploadModBVideo(input) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      const pathInput = document.getElementById('videoPathInput');
      pathInput.value = 'Yükleniyor: ' + file.name + '...';
      try {
        const ext = getFileExt(file.name);
        const res = await fetch('/api/studio/upload?batchId=modb_raw&role=video&ext=' + encodeURIComponent(ext), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        pathInput.value = data.localFilePath;
      } catch (err) {
        pathInput.value = '';
        alert('Dosya yüklenemedi: ' + err.message);
      }
    }

    async function bakeAllBrands() {
      const btn = document.getElementById('btnBakeAll');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Tüm Sağlıklı Markalara Üretiliyor...';
      try {
        const res = await fetch('/api/bake-all', { method: 'POST' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const s = data.summary;
        alert(\`🌾 Toplu üretim tamamlandı! Başarılı: \${s.succeeded.length} / \${s.totalQualifiedBrands} marka. Onaylamak için Lappsoft Social kuyruğunu açabilirsiniz.\`);
        switchTab('gallery');
      } catch (err) {
        alert('Toplu üretim hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> <span>Tüm Sağlıklı Markalara Üret</span>';
      }
    }

    async function syncLearning() {
      const btn = document.getElementById('btnLearnSync');
      btn.disabled = true;
      btn.innerText = 'Analiz ediliyor...';
      try {
        const res = await fetch('/api/learning/sync', { method: 'POST' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        await loadBrands();
        alert('🧠 Öğrenme Motoru güncellendi (' + data.syncedCount + ' marka).');
      } catch (err) {
        alert('Öğrenme hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Öğrenmeyi Yenile';
      }
    }

    async function bakeVideo() {
      const videoPath = document.getElementById('videoPathInput').value.trim();
      if (!videoPath) {
        alert('Lütfen geçerli bir video dosyası yolu girin.');
        return;
      }
      const btn = document.getElementById('btnBakeVideo');
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin"></i> Kurgulanıyor ve Social Onayına Gönderiliyor...';

      try {
        const res = await fetch('/api/bake-video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandSlug: currentBrand, videoPath })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        alert('🎉 Ham video kurgulandı ve Lappsoft Social Onay Kuyruğuna bırakıldı! Skor: ' + data.package.validation.overallScore + '/100');
        switchTab('gallery');
      } catch (err) {
        alert('Kurgu hatası: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-film"></i> <span>Videoyu Kurgula ve Social Onayına Gönder</span>';
      }
    }

    async function loadPackages() {
      try {
        const res = await fetch('/api/packages');
        const data = await res.json();
        const pkgs = data.packages || [];
        document.getElementById('bakedCount').innerText = pkgs.length;

        const container = document.getElementById('galleryList');
        const empty = document.getElementById('galleryEmpty');

        if (pkgs.length === 0) {
          container.innerHTML = '';
          empty.classList.remove('hidden');
          return;
        }

        empty.classList.add('hidden');
        container.innerHTML = pkgs.map(p => {
          const platBadges = (p.platforms || []).map(pl =>
            \`<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] uppercase">\${esc(pl)}</span>\`
          ).join('');
          return \`<div class="glass-card rounded-2xl overflow-hidden flex flex-col transition hover:border-slate-600">
            \${p.thumbnailUrl ? \`<div data-id="\${esc(p.batchId)}" class="aspect-square bg-slate-900 overflow-hidden cursor-pointer" onclick="viewPackage(this.dataset.id)">
              <img src="\${esc(p.thumbnailUrl)}" class="w-full h-full object-cover hover:scale-105 transition duration-300">
            </div>\` : ''}
            <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
              <div>
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-semibold">\${esc(p.brand?.name)}</span>
                  <span class="text-emerald-400 font-bold">\${esc(p.score)}/100</span>
                </div>
                <h4 class="font-bold text-sm text-slate-100 line-clamp-2">\${esc(p.topic)}</h4>
                <div class="flex flex-wrap gap-1 mt-2">\${platBadges}</div>
                <div class="mt-2.5">
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold">
                    ⏳ Social Onayı Bekliyor
                  </span>
                </div>
              </div>
              <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span class="text-[11px] text-slate-500">\${esc(new Date(p.createdAt).toLocaleDateString('tr-TR'))}</span>
                <button data-id="\${esc(p.batchId)}" onclick="viewPackage(this.dataset.id)" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 border border-slate-700">
                  İncele
                </button>
              </div>
            </div>
          </div>\`;
        }).join('');
      } catch (err) {
        console.error('Paketler yüklenemedi', err);
      }
    }

    async function viewPackage(batchId) {
      try {
        const res = await fetch('/api/package/' + encodeURIComponent(batchId));
        const pkg = await res.json();
        if (pkg.error) throw new Error(pkg.error);

        document.getElementById('modalTitle').innerText = pkg.sourceMetadata?.topic || 'İçerik Paketi';
        document.getElementById('modalSubtitle').innerText =
          \`Marka: \${pkg.brand?.name} • Denetim Skoru: \${pkg.validation?.overallScore}/100 (\${pkg.validation?.status}) • Revizyon: \${pkg.revisionCount || 0}\`;

        const handoffBanner = \`
          <div class="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div class="text-amber-200">
              <b>Durum:</b> Lappsoft Social Onay Kuyruğunda <b>ONAY BEKLİYOR</b> (\${esc(pkg.socialHandoff?.deliveriesCount || Object.keys(pkg.deliveries || {}).length)} sağlıklı platform). Onay ve yayınlama işlemi yalnızca Social üzerinden yapılır.
            </div>
            <a href="\${esc(socialQueueUrl)}" target="_blank" rel="noreferrer" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
              Social Kuyruğunda Aç ↗
            </a>
          </div>
        \`;

        const deliveriesHtml = Object.entries(pkg.deliveries || {}).map(([platform, c]) => {
          const copyPayload = (c.caption || '') + ((c.hashtags && c.hashtags.length) ? '\\n\\n' + c.hashtags.join(' ') : '');
          return \`<div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold uppercase tracking-wider text-amber-400">\${esc(platform)}</span>
              <button data-copy="\${esc(copyPayload)}" onclick="copyFromAttr(this)" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] rounded text-slate-200 border border-slate-700">
                <i class="fa-regular fa-copy"></i> Kopyala
              </button>
            </div>
            <p class="text-xs font-bold text-slate-100">\${esc(c.headline)}</p>
            \${c.hookText ? \`<p class="text-xs text-rose-300 font-semibold">Hook: \${esc(c.hookText)}</p>\` : ''}
            <p class="text-xs text-slate-300 whitespace-pre-wrap">\${esc(c.caption)}</p>
            <p class="text-[11px] text-sky-400 font-mono">\${esc((c.hashtags || []).join(' '))}</p>
          </div>\`;
        }).join('');

        let mediaHtml = '<div class="space-y-4"><div class="grid grid-cols-1 sm:grid-cols-3 gap-4">';

        if (pkg.media?.videoVertical) {
          const vUrl = '/media/' + encodeURIComponent(pkg.batchId) + '/' + encodeURIComponent(pkg.media.videoVertical.fileName);
          mediaHtml += \`
            <div class="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-rose-400">9:16 Dikey Video</span>
                <a href="\${esc(vUrl)}" download class="text-[11px] text-indigo-400 hover:underline">İndir</a>
              </div>
              <video controls src="\${esc(vUrl)}" class="w-full aspect-[9/16] rounded-lg bg-black object-cover border border-slate-800"></video>
            </div>\`;
        }

        const photoAsset = (pkg.media?.additionalAssets || []).find(a => a.kind === 'IMAGE_CARD');
        if (photoAsset) {
          const pUrl = '/media/' + encodeURIComponent(pkg.batchId) + '/' + encodeURIComponent(photoAsset.fileName);
          mediaHtml += \`
            <div class="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-emerald-400">Sahne Fotoğrafı</span>
                <a href="\${esc(pUrl)}" download class="text-[11px] text-indigo-400 hover:underline">İndir</a>
              </div>
              <img src="\${esc(pUrl)}" class="w-full aspect-[9/16] rounded-lg object-cover border border-slate-800">
            </div>\`;
        }

        if (pkg.media?.thumbnail) {
          const tUrl = '/media/' + encodeURIComponent(pkg.batchId) + '/' + encodeURIComponent(pkg.media.thumbnail.fileName);
          mediaHtml += \`
            <div class="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-amber-400">Tipografik Kapak</span>
                <a href="\${esc(tUrl)}" download class="text-[11px] text-indigo-400 hover:underline">İndir</a>
              </div>
              <img src="\${esc(tUrl)}" class="w-full aspect-[9/16] rounded-lg object-cover border border-slate-800">
            </div>\`;
        }

        mediaHtml += '</div>';

        if (pkg.hasVoiceover) {
          const aUrl = '/media/' + encodeURIComponent(pkg.batchId) + '/voiceover.mp3';
          mediaHtml += \`
            <div class="p-3 bg-slate-900/70 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span class="text-xs font-bold text-slate-300">🎙️ Türkçe Seslendirme (Voiceover MP3)</span>
              <audio controls src="\${esc(aUrl)}" class="h-9 w-full sm:w-72"></audio>
            </div>\`;
        }

        mediaHtml += '</div>';

        document.getElementById('modalContent').innerHTML = \`
          \${handoffBanner}
          \${mediaHtml}
          <div class="space-y-3">
            <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider">Sağlıklı Platformlara Özgü Gönderiler</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              \${deliveriesHtml}
            </div>
          </div>
        \`;

        document.getElementById('detailModal').classList.remove('hidden');
      } catch (err) {
        alert('Detay yüklenemedi: ' + err.message);
      }
    }

    function closeModal() {
      document.getElementById('detailModal').classList.add('hidden');
    }

    function copyFromAttr(btn) {
      navigator.clipboard.writeText(btn.dataset.copy || '');
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> Kopyalandı!';
      setTimeout(() => btn.innerHTML = original, 2000);
    }

    function refreshData() {
      loadBrands();
      loadHubStatus();
      loadPackages();
    }

    init();
  </script>
</body>
</html>`;
}

// Periyodik geri bildirim ve öğrenme döngüsü (30 dakikada bir gerçek paylaşım metriklerini kontrol eder)
const learningTimer = setInterval(() => {
  LearningEngine.syncAllQualifiedBrands().catch((err) =>
    console.warn("[Toprak Periodic Learning] Uyarı:", err)
  );
}, LEARNING_INTERVAL_MS);
learningTimer.unref();

server.listen(PORT, HOST, () => {
  console.log(`\n🌾 TOPRAK BAĞIMSIZ STÜDYO AYAKTA!`);
  console.log(`===============================================`);
  console.log(`🌐 Toprak Stüdyo Adresi : http://${HOST}:${PORT}`);
  console.log(`📥 Social Onay Kuyruğu  : ${loadToprakConfig().socialBaseUrl}/queue`);
  console.log(`🧠 Periyodik Öğrenme    : Her 30 dakikada bir aktif`);
  console.log(`===============================================\n`);
});
