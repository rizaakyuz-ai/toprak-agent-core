import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { ToprakAiHub } from "../../core/ai-hub";
import { BrandKnowledge, BrandProfile } from "../../core/types";

export interface GenerateImageOptions {
  prompt: string;
  brand: BrandProfile | BrandKnowledge;
  outputPath: string;
  aspectRatio?: "9:16" | "1:1";
}

// Marka veya sektör bazlı yüksek çözünürlüklü tematik stok yedekleri (AI görsel kotası dolduğunda kullanılır)
const BRAND_THEME_PHOTOS: Record<string, string[]> = {
  modena: [
    "https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=1080&h=1920&q=85",
  ],
  "lappsoft-hq": [
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1080&h=1920&q=85",
  ],
  "career-ai": [
    "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1080&h=1920&q=85",
  ],
  tabirai: [
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1080&h=1920&q=85",
  ],
  solatb: [
    "https://images.unsplash.com/photo-1642543492481-44e81e3914a7?auto=format&fit=crop&w=1080&h=1920&q=85",
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1080&h=1920&q=85",
  ],
};

export class ImageGenerator {
  /**
   * Merkezi AI Hub (ToprakAiHub.generateImage) üzerinden dikey/kare görsel üretir.
   * API kotası yoksa markaya uygun yüksek çözünürlüklü tematik fotoğraf veya yerel marka tuvali hazırlar.
   */
  static async generatePhoto(opts: GenerateImageOptions): Promise<string> {
    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const ratio = opts.aspectRatio || "9:16";
    const width = 1080;
    const height = ratio === "1:1" ? 1080 : 1920;

    // 1. ÖNCELİK: Merkezi AI Hub Görsel Üretimi
    const aiImg = await ToprakAiHub.generateImage(opts.prompt, ratio);
    if (aiImg && aiImg.buffer.length > 0) {
      await sharp(aiImg.buffer)
        .resize(width, height, { fit: "cover", position: "attention" })
        .jpeg({ quality: 92 })
        .toFile(opts.outputPath);
      console.log(
        `[Toprak ImageGenerator] ✅ AI Hub (${aiImg.modelUsed}) ile özgün fotoğraf üretildi (${aiImg.durationMs}ms).`
      );
      return opts.outputPath;
    }

    // 2. YEDEK: Marka / Sektör Uyumlu Tematik Fotoğraf
    console.log(
      `[Toprak ImageGenerator] ℹ️ AI görsel kotası aktif değil; "${opts.brand.name}" sektörüne uygun tematik fotoğraf indiriliyor...`
    );
    const slug = opts.brand.slug.toLowerCase();
    const sectorLower = opts.brand.sector.toLocaleLowerCase("tr-TR");
    const photos =
      BRAND_THEME_PHOTOS[slug] ||
      (sectorLower.includes("moda") || sectorLower.includes("stil")
        ? BRAND_THEME_PHOTOS.modena
        : sectorLower.includes("kariyer") || sectorLower.includes("iş")
        ? BRAND_THEME_PHOTOS["career-ai"]
        : sectorLower.includes("rüya") || sectorLower.includes("psikoloji")
        ? BRAND_THEME_PHOTOS.tabirai
        : sectorLower.includes("finans") || sectorLower.includes("kripto")
        ? BRAND_THEME_PHOTOS.solatb
        : BRAND_THEME_PHOTOS["lappsoft-hq"]);

    const selectedUrl = photos[Math.floor(Math.random() * photos.length)];

    try {
      const imgRes = await fetch(selectedUrl, { signal: AbortSignal.timeout(10000) });
      if (imgRes.ok) {
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        await sharp(buffer)
          .resize(width, height, { fit: "cover", position: "center" })
          .jpeg({ quality: 90 })
          .toFile(opts.outputPath);
        console.log(`[Toprak ImageGenerator] ✅ Tematik fotoğraf hazırlandı: ${opts.outputPath}`);
        return opts.outputPath;
      }
    } catch (e) {
      console.warn("[Toprak ImageGenerator] Tematik fotoğraf indirilemedi, yerel marka tuvali üretiliyor:", e);
    }

    // 3. ÇEVRİMDIŞI GARANTİSİ: Yerel Marka Renk Degrade Tuvali
    const primary = opts.brand.primaryColor || "#1e3a8a";
    const accent = opts.brand.accentColor || "#3b82f6";
    const fallbackSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="50%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="${accent}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#g)" />
    </svg>`;

    await sharp(Buffer.from(fallbackSvg))
      .jpeg({ quality: 90 })
      .toFile(opts.outputPath);

    return opts.outputPath;
  }
}
