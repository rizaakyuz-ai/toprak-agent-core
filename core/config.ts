import fs from "node:fs";
import path from "node:path";
import { BrandProfile, BrandProfileSchema } from "./types";

export type TtsProviderType = "google" | "edge" | "silent";

export interface ToprakConfig {
  hqRoot: string;
  toprakRoot: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  openAiApiKey?: string;
  ttsProvider: TtsProviderType;
  storageDir: string;
  socialBaseUrl: string;
  bridgeSecret: string;
  brands: BrandProfile[];
}

export const TOPRAK_ROOT = path.resolve(__dirname, "..");
export const HQ_ROOT = path.resolve(TOPRAK_ROOT, "..");
const BRANDS_CONFIG_PATH = path.join(TOPRAK_ROOT, "config", "markalar_sablonu.json");

let cachedConfig: ToprakConfig | null = null;

function loadEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }
  } catch (err) {
    console.warn(`[Toprak Config] ${filePath} okunamadı:`, err);
  }
  return result;
}

export function loadToprakConfig(opts: { reload?: boolean } = {}): ToprakConfig {
  if (cachedConfig && !opts.reload) {
    return cachedConfig;
  }

  const rootEnvLocal = loadEnvFile(path.join(HQ_ROOT, ".env.local"));
  const toprakEnv = loadEnvFile(path.join(TOPRAK_ROOT, ".env"));

  // Social alt modüllerinin (vault, storage, pglite) doğru çalışması için eksik ortam değişkenlerini process.env'ye aktar
  const mergedEnv: Record<string, string> = { ...rootEnvLocal, ...toprakEnv };
  for (const [k, v] of Object.entries(mergedEnv)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
    }
  }

  // PGlite veri dizininin çalışma dizininden (cwd) bağımsız olarak her zaman ana dizini işaret etmesini garantile
  if (!process.env.PGLITE_DATA_DIR?.trim()) {
    process.env.PGLITE_DATA_DIR = path.join(HQ_ROOT, ".data", "postgres");
  }

  const getEnv = (key: string): string | undefined => {
    const val = process.env[key] ?? toprakEnv[key] ?? rootEnvLocal[key];
    return val && val.trim().length > 0 ? val.trim() : undefined;
  };

  let brands: BrandProfile[] = [];
  if (fs.existsSync(BRANDS_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(BRANDS_CONFIG_PATH, "utf-8"));
      if (Array.isArray(parsed.brands)) {
        brands = parsed.brands.map((b: unknown) => BrandProfileSchema.parse(b));
      }
    } catch (e) {
      console.error("[Toprak Config] Marka şablonu parse edilemedi:", e);
    }
  }

  const rawStorageDir = getEnv("TOPRAK_STORAGE_DIR");
  const storageDir = rawStorageDir
    ? path.resolve(TOPRAK_ROOT, rawStorageDir)
    : path.join(TOPRAK_ROOT, "storage");

  const dirs = [
    storageDir,
    path.join(storageDir, "raw"),
    path.join(storageDir, "transcripts"),
    path.join(storageDir, "baked"),
    path.join(storageDir, "brands"),
    path.join(storageDir, "memory"),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  const rawTts = (getEnv("TOPRAK_TTS_PROVIDER") || "google").toLowerCase();
  const ttsProvider: TtsProviderType =
    rawTts === "edge" ? "edge" : rawTts === "silent" ? "silent" : "google";

  const socialBaseUrl =
    getEnv("TOPRAK_SOCIAL_INTERNAL_URL") || "http://127.0.0.1:3000";
  const bridgeSecret =
    getEnv("TOPRAK_BRIDGE_SECRET") ||
    getEnv("AUTH_SECRET") ||
    getEnv("ENCRYPTION_MASTER_KEY") ||
    "lappsoft-toprak-local-bridge";

  cachedConfig = {
    hqRoot: HQ_ROOT,
    toprakRoot: TOPRAK_ROOT,
    geminiApiKey: getEnv("GEMINI_API_KEY") || getEnv("GOOGLE_GENAI_API_KEY"),
    groqApiKey: getEnv("GROQ_API_KEY"),
    openAiApiKey: getEnv("OPENAI_API_KEY"),
    ttsProvider,
    storageDir,
    socialBaseUrl,
    bridgeSecret,
    brands,
  };

  return cachedConfig;
}

export function getBrandTemplateConfig(slug: string): BrandProfile | undefined {
  const config = loadToprakConfig();
  return config.brands.find(
    (b) =>
      b.slug.toLowerCase() === slug.toLowerCase() ||
      b.id.toLowerCase() === slug.toLowerCase()
  );
}

// Geriye dönük uyumluluk takma adı
export const getBrandConfig = getBrandTemplateConfig;
