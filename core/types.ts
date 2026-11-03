import { z } from "zod";

// ==========================================
// 1. MARKA TANIMLARI
// ==========================================
export const BrandProfileSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  sector: z.string(),
  toneOfVoice: z.string(),
  targetAudience: z.string(),
  primaryColor: z.string().default("#3b82f6"),
  accentColor: z.string().default("#60a5fa"),
  defaultLanguage: z.enum(["tr", "en", "de", "ru", "it", "es", "ar", "zh"]).default("tr"),
  hashtags: z.array(z.string()).default([]),
  bannedWords: z.array(z.string()).default([]),
  contentAngles: z.array(z.string()).default([]),
  healthyPlatforms: z.array(z.string()).default([]),
});

export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const BrandKnowledgeSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  websiteUrl: z.string().default(""),
  primaryColor: z.string().default("#3b82f6"),
  accentColor: z.string().default("#60a5fa"),
  defaultLanguage: z.enum(["tr", "en", "de", "ru", "it", "es", "ar", "zh"]).default("tr"),
  healthyPlatforms: z.array(z.string()).default([]),
  sector: z.string(),
  tagline: z.string(),
  mission: z.string(),
  valueProposition: z.string(),
  targetAudience: z.string(),
  toneOfVoice: z.string(),
  coreProducts: z.array(z.string()).default([]),
  mainCompetitors: z.array(z.string()).default([]),
  consumerPainPoints: z.array(z.string()).default([]),
  contentPillars: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  bannedWords: z.array(z.string()).default([]),
  lastSyncedAt: z.string(),
});

export type BrandKnowledge = z.infer<typeof BrandKnowledgeSchema>;

// ==========================================
// 2. DESTEKLENEN PLATFORMLAR VE MEDYA TİPLERİ
// ==========================================
export const TOPRAK_PLATFORMS = [
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "x",
  "linkedin",
  "youtube",
  "pinterest",
  "reddit",
  "github",
] as const;

export type ToprakPlatform = (typeof TOPRAK_PLATFORMS)[number];

export type MediaAspectRatio = "9:16" | "1:1" | "16:9" | "4:5";

// ==========================================
// 3. TRANSKRİPSİYON & ZAMAN DAMGASI
// ==========================================
export const WordTimestampSchema = z.object({
  word: z.string(),
  start: z.number(), // Saniye cinsinden (örn: 1.24)
  end: z.number(),   // Saniye cinsinden (örn: 1.68)
  confidence: z.number().optional(),
});

export type WordTimestamp = z.infer<typeof WordTimestampSchema>;

export const TranscriptResultSchema = z.object({
  fullText: z.string(),
  language: z.string().default("tr"),
  durationSec: z.number(),
  words: z.array(WordTimestampSchema),
  srtContent: z.string().optional(),
});

export type TranscriptResult = z.infer<typeof TranscriptResultSchema>;

// ==========================================
// 4. PLATFORMA ÖZEL İÇERİK UYARLAMASI
// ==========================================
export const PlatformContentSchema = z.object({
  platform: z.enum(TOPRAK_PLATFORMS),
  headline: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  hookText: z.string().optional(),
  callToAction: z.string().optional(),
  videoScript: z
    .object({
      visualCues: z.array(z.string()).default([]),
      onScreenTexts: z.array(z.string()).default([]),
      voiceoverText: z.string().optional(),
      voiceoverPhoneticTr: z.string().optional(),
      speechStyleDirective: z.string().optional(),
      emotionPreset: z
        .enum([
          "EXCITED_INSPIRING",
          "WARM_CONFIDENT",
          "MYSTIC_CALM",
          "SHARP_AUTHORITATIVE",
          "CURIOUS_DYNAMIC",
        ])
        .optional(),
    })
    .optional(),
  characterCount: z.number().default(0),
});

export type PlatformContent = z.infer<typeof PlatformContentSchema>;

// ==========================================
// 5. MEDYA VARLIĞI
// ==========================================
export const MediaAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["VIDEO_VERTICAL", "THUMBNAIL", "IMAGE_CARD", "AUDIO"]),
  aspectRatio: z.enum(["9:16", "1:1", "16:9", "4:5"]),
  localFilePath: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  fileSizeBytes: z.number().default(0),
});

export type MediaAsset = z.infer<typeof MediaAssetSchema>;

// ==========================================
// 6. SİNEMATİK PRODÜKSİYON PROMPTLARI (AI DIRECTOR)
// ==========================================
export const ProductionPromptsSchema = z.object({
  videoPrompt: z.object({
    masterPromptEn: z.string(),
    cameraMovement: z.string(),
    lensAndAperture: z.string(),
    lightingAndAtmosphere: z.string(),
    actionChoreography: z.string(),
    aspectRatio: z.string().default("9:16"),
    durationSec: z.number().default(10),
    fps: z.number().default(24),
    negativePrompt: z.string(),
    klingMotionTag: z.string().optional(),
  }),
  photoPrompt: z.object({
    masterPromptEn: z.string(),
    composition: z.string(),
    lighting: z.string(),
    aspectRatio: z.string().default("9:16"),
    negativePrompt: z.string(),
    midjourneyFlags: z.string().optional(),
    fluxPromptEn: z.string().optional(),
  }),
  characterConsistency: z
    .object({
      modelDescriptionEn: z.string(),
      wardrobeStylingEn: z.string(),
      ethnicAesthetic: z.string().default("Contemporary natural"),
      approximateAge: z.number().default(28),
    })
    .optional(),
  voiceAndAudioPrompt: z
    .object({
      voiceGender: z.string().default("Female"),
      toneAndVibe: z.string().default("Warm, articulate, natural, confident"),
      elevenLabsStability: z.number().default(0.65),
      elevenLabsClarity: z.number().default(0.85),
      sunoMusicPromptEn: z.string().default("100 BPM modern clean ambient electronic background rhythm"),
      sunoBpm: z.number().default(100),
    })
    .optional(),
});

export type ProductionPrompts = z.infer<typeof ProductionPromptsSchema>;

// ==========================================
// 7. KALİTE KONTROL VE DENETİM RAPORU
// ==========================================
export const ValidationReportSchema = z.object({
  status: z.enum(["APPROVED", "NEEDS_REVISION", "REJECTED"]),
  overallScore: z.number().min(0).max(100),
  brandToneScore: z.number().min(0).max(100),
  grammarScore: z.number().min(0).max(100),
  hookQualityScore: z.number().min(0).max(100),
  visualFeasibilityScore: z.number().min(0).max(100).optional(),
  platformSafetyScore: z.number().min(0).max(100).optional(),
  passedRules: z.array(z.string()).default([]),
  violations: z.array(z.string()).default([]),
  improvementNotes: z.string().default(""),
  expertAudits: z
    .object({
      brandAuditor: z.object({ passed: z.boolean(), notes: z.string() }).optional(),
      linguisticLead: z.object({ passed: z.boolean(), notes: z.string(), clichesFound: z.array(z.string()).default([]) }).optional(),
      visualLead: z.object({ passed: z.boolean(), notes: z.string() }).optional(),
      platformSafetyLead: z.object({ passed: z.boolean(), notes: z.string() }).optional(),
      neuroMarketingJudge: z.object({ passed: z.boolean(), notes: z.string() }).optional(),
    })
    .optional(),
  actionableRevisions: z.array(z.string()).default([]),
  evaluatedAt: z.string(),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;

// ==========================================
// 8. NİHAİ FIRIN PAKETİ (THE BAKED BREAD)
// ==========================================
export const BakedPackageSchema = z.object({
  batchId: z.string(),
  sourceMode: z.enum(["MOD_A_AUTONOMOUS", "MOD_B_INJECTION"]),
  createdAt: z.string(),
  brand: z.object({
    slug: z.string(),
    name: z.string(),
    sector: z.string(),
  }),
  sourceMetadata: z.object({
    rawFileName: z.string().optional(),
    rawDurationSec: z.number().optional(),
    topic: z.string(),
    summary: z.string(),
  }),
  productionPrompts: ProductionPromptsSchema.optional(),
  media: z.object({
    videoVertical: MediaAssetSchema.optional(),
    thumbnail: MediaAssetSchema.optional(),
    additionalAssets: z.array(MediaAssetSchema).default([]),
  }),
  deliveries: z.record(z.enum(TOPRAK_PLATFORMS), PlatformContentSchema),
  validation: ValidationReportSchema,
  revisionCount: z.number().default(0),
  socialHandoff: z
    .object({
      postId: z.string(),
      sourceRef: z.string(),
      approvalStatus: z.enum(["PENDING_APPROVAL", "APPROVED", "DRAFT"]).default("PENDING_APPROVAL"),
      pushedAutomatically: z.boolean(),
      deliveriesCount: z.number(),
      injectedAt: z.string(),
    })
    .optional(),
  status: z
    .enum(["BAKED_READY", "PENDING_SOCIAL_APPROVAL", "HANDED_OFF", "FAILED"])
    .default("BAKED_READY"),
});

export type BakedPackage = z.infer<typeof BakedPackageSchema>;
