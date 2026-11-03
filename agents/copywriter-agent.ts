import { z } from "zod";
import { ToprakAiHub } from "../core/ai-hub";
import {
  BrandKnowledge,
  BrandProfile,
  PlatformContent,
  TOPRAK_PLATFORMS,
  ToprakPlatform,
  ValidationReport,
} from "../core/types";
import { BrandKnowledgeStore } from "../core/brand-knowledge-store";
import { LearningEngine } from "../core/learning-engine";
import { ScenarioDefinition } from "../core/scenario-manager";
import { TrendIdeaDeep } from "./trend-agent";
import { TurkishPhoneticNormalizer } from "../pipelines/media/tts-engine";

// ==========================================
// 1. ŞEMA TANIMLARI (MARKADAN BAĞIMSIZ, TARAFSIZ VARSAYILANLAR)
// ==========================================

export const ContentFormatTypeSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    const upper = val.toUpperCase().trim();
    if (upper.includes("VIDEO") || upper.includes("REEL") || upper.includes("SHORT") || upper.includes("TIKTOK")) {
      return "VERTICAL_VIDEO";
    }
    if (upper.includes("POSTER") || upper.includes("IMAGE") || upper.includes("PHOTO") || upper.includes("PIN")) {
      return "EDITORIAL_POSTER";
    }
    if (upper.includes("CAROUSEL")) return "CAROUSEL_SERIES";
    if (upper.includes("THREAD") || upper === "X") return "X_THREAD";
    if (upper.includes("COMMUNITY") || upper.includes("TEXT") || upper.includes("POST")) {
      return "COMMUNITY_POST";
    }
  }
  return "VERTICAL_VIDEO";
}, z.enum([
  "VERTICAL_VIDEO",
  "EDITORIAL_POSTER",
  "CAROUSEL_SERIES",
  "X_THREAD",
  "COMMUNITY_POST",
]));

export type ContentFormatType = z.infer<typeof ContentFormatTypeSchema>;

export const CinematographySchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return {
      cameraRig: val,
      lensAndFocal: "35mm prime f/1.8",
      lightingAndAtmosphere: "Doğal ve dengeli sinematik ışık",
      actionChoreography: val,
    };
  }
  if (!val || typeof val !== "object") {
    return {
      cameraRig: "Gimbal slow push-in",
      lensAndFocal: "35mm prime f/1.8",
      lightingAndAtmosphere: "Doğal ve dengeli sinematik ışık",
      actionChoreography: "Doğal mikro hareket ve odak geçişi",
    };
  }
  return val;
}, z.object({
  cameraRig: z.string().default("Gimbal slow push-in"),
  lensAndFocal: z.string().default("35mm prime f/1.8"),
  lightingAndAtmosphere: z.string().default("Doğal ve dengeli sinematik ışık"),
  actionChoreography: z.string().default("Doğal mikro hareket ve odak geçişi"),
}));

export const OnScreenTextSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return {
      text: val,
      typographyStyle: "Bold Sans-serif, Yüksek Kontrast",
      screenPosition: "Center Safe-Zone",
    };
  }
  if (!val || typeof val !== "object") {
    return {
      text: "",
      typographyStyle: "Bold Sans-serif",
      screenPosition: "Center Safe-Zone",
    };
  }
  return val;
}, z.object({
  text: z.string().default(""),
  typographyStyle: z.string().default("Bold Sans-serif"),
  screenPosition: z.string().default("Center Safe-Zone"),
}));

export const VoiceoverSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return {
      text: val,
      speakingPace: "Doğal, akıcı ve güven veren ton",
    };
  }
  if (!val || typeof val !== "object") {
    return {
      text: "",
      speakingPace: "Doğal ve akıcı",
    };
  }
  return val;
}, z.object({
  text: z.string().default(""),
  speakingPace: z.string().default("Doğal ve akıcı"),
}));

export const TimelineSceneSchema = z.preprocess((val: unknown) => {
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (!obj.cinematography) {
      obj.cinematography = "Gimbal slow push-in";
    }
  }
  return val;
}, z.object({
  timeRange: z.string().default("00:00 - 00:05"),
  sceneMood: z.string().default("FOCUSED_CLARITY"),
  cinematography: CinematographySchema,
  onScreenText: OnScreenTextSchema,
  voiceover: VoiceoverSchema,
}));

export const AudioDesignSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return {
      musicTrackStyle: val,
      soundEffects: ["Subtle transition whoosh"],
    };
  }
  return val;
}, z.object({
  musicTrackStyle: z.string().default("100 BPM modern temiz atmosferik ritim"),
  soundEffects: z.array(z.string()).default([]),
})).default({
  musicTrackStyle: "100 BPM modern temiz atmosferik ritim",
  soundEffects: ["Subtle transition whoosh"],
});

export const EmotionalArcSchema = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return val.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" -> ");
  }
  return val;
}, z.string().default("Merak -> Aydınlanma -> Güven"));

export const VoiceDirectionSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return {
      voiceoverPhoneticTr: "",
      speechStyleDirective: val,
      emotionPreset: "WARM_CONFIDENT",
    };
  }
  return val && typeof val === "object" ? val : {};
}, z.object({
  voiceoverPhoneticTr: z.string().default(""),
  speechStyleDirective: z
    .string()
    .default(
      "Warm, lively, confident native Istanbul Turkish delivery at natural conversational Reels pace (~148 words per minute) with genuine enthusiasm on the hook and warm clarity on the call to action."
    ),
  emotionPreset: z
    .enum([
      "EXCITED_INSPIRING",
      "WARM_CONFIDENT",
      "MYSTIC_CALM",
      "SHARP_AUTHORITATIVE",
      "CURIOUS_DYNAMIC",
    ])
    .catch("WARM_CONFIDENT")
    .default("WARM_CONFIDENT"),
})).default({
  voiceoverPhoneticTr: "",
  speechStyleDirective:
    "Warm, lively, confident native Istanbul Turkish delivery at natural conversational Reels pace (~148 words per minute) with genuine enthusiasm on the hook and warm clarity on the call to action.",
  emotionPreset: "WARM_CONFIDENT",
});

export const VideoProductionPlanSchema = z.object({
  overallDurationSec: z.number().default(30),
  overallEmotionalArc: EmotionalArcSchema,
  audioDesign: AudioDesignSchema,
  voiceDirection: VoiceDirectionSchema,
  scenes: z.array(TimelineSceneSchema).default([]),
});

export const GraphicPosterLayoutSchema = z.preprocess((val: unknown) => {
  if (typeof val === "string") {
    return {
      mainHeadline: val,
      subHeadline: "",
      badgeOrTagText: "",
      logoPlacement: "Alt Orta",
      fontVibe: "Modern Editorial Sans",
    };
  }
  return val;
}, z.object({
  mainHeadline: z.string().default(""),
  subHeadline: z.string().default(""),
  badgeOrTagText: z.string().optional().default(""),
  logoPlacement: z.string().default("Alt Orta"),
  fontVibe: z.string().default("Modern Editorial Sans"),
}));

export const ImageGenPromptSchema = z.preprocess((val: unknown) => {
  if (typeof val === "string") {
    return {
      masterPromptEn: val,
      negativePrompt: "deformed, blurry, low quality, bad anatomy, text watermarks",
      styleKeywords: ["commercial photography", "sharp focus", "8k"],
    };
  }
  return val;
}, z.object({
  masterPromptEn: z.string().default("High-end commercial editorial photography, natural lighting, 8k resolution"),
  negativePrompt: z.string().default("deformed, blurry, low quality, bad anatomy, text watermarks"),
  styleKeywords: z.array(z.string()).default(["commercial photography", "sharp focus", "8k"]),
}));

export const ArtDirectionSchema = z.preprocess((val: unknown) => {
  if (typeof val === "string") {
    return {
      compositionAndFraming: val,
      lightingAndMood: "Doğal yumuşak stüdyo ışığı",
      colorPalette: ["#0f172a", "#3b82f6"],
      graphicPosterLayout: {
        mainHeadline: "",
        subHeadline: "",
        badgeOrTagText: "",
        logoPlacement: "Alt Orta",
        fontVibe: "Modern Editorial Sans",
      },
      imageGenPrompt: {
        masterPromptEn: "High-end commercial editorial photography, natural lighting, 8k resolution",
        negativePrompt: "blurry, low quality, text watermarks",
        styleKeywords: ["commercial", "editorial"],
      },
    };
  }
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (!obj.graphicPosterLayout) obj.graphicPosterLayout = {};
    if (!obj.imageGenPrompt) obj.imageGenPrompt = {};
  }
  return val;
}, z.object({
  compositionAndFraming: z.string().default("Rule of thirds, Negative space for typography"),
  lightingAndMood: z.string().default("Doğal yumuşak stüdyo ışığı"),
  colorPalette: z.preprocess(
    (val) =>
      typeof val === "string"
        ? val.split(/[,|]/).map((s) => s.trim())
        : Array.isArray(val)
        ? val
        : ["#0f172a", "#3b82f6"],
    z.array(z.string()).default(["#0f172a", "#3b82f6"])
  ),
  graphicPosterLayout: GraphicPosterLayoutSchema,
  imageGenPrompt: ImageGenPromptSchema,
}));

export const PosterProductionPlanSchema = z.preprocess((val: unknown) => {
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (!obj.artDirection) {
      obj.artDirection = "Doğal yumuşak ışık ve modern kompozisyon";
    }
  }
  return val;
}, z.object({
  conceptTitle: z.string().default("Editoryal Kampanya Afişi"),
  aspectRatio: z.enum(["9:16", "1:1", "4:5", "16:9"]).default("4:5"),
  targetEmotion: z.string().default("Merak ve Güven"),
  artDirection: ArtDirectionSchema,
}));

export const CarouselSlideSchema = z.object({
  slideNumber: z.number(),
  slideType: z
    .enum(["HOOK_COVER", "PROBLEM_AGITATION", "VALUE_STEP", "REVEAL", "SUMMARY_CTA"])
    .default("VALUE_STEP"),
  headline: z.string(),
  bodyText: z.string(),
  designVisualPrompt: z.string().default("Clean modern editorial background"),
  onScreenLayout: z.string().default("Header on top, visual in center, concise copy below"),
});

export const CarouselProductionPlanSchema = z.object({
  totalSlides: z.number().default(5),
  slides: z.array(CarouselSlideSchema).default([]),
});

export const ThreadTweetsSchema = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        return String(rec.tweet || rec.text || rec.content || rec.body || JSON.stringify(item));
      }
      return String(item);
    });
  }
  return val;
}, z.array(z.string()).optional());

function normalizePlatformKey(rawKey: string): ToprakPlatform | null {
  const cleaned = rawKey.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((TOPRAK_PLATFORMS as readonly string[]).includes(cleaned)) {
    return cleaned as ToprakPlatform;
  }
  const aliasMap: Record<string, ToprakPlatform> = {
    twitter: "x",
    x_twitter: "x",
    "x_(twitter)": "x",
    x_thread: "x",
    ig: "instagram",
    instagram_reels: "instagram",
    reels: "instagram",
    fb: "facebook",
    yt: "youtube",
    youtube_shorts: "youtube",
    shorts: "youtube",
    li: "linkedin",
  };
  return aliasMap[cleaned] ?? null;
}

export const PlatformMasterProductionSchema = z.preprocess((val: unknown) => {
  if (val && typeof val === "object") {
    const obj = { ...(val as Record<string, any>) };
    if (typeof obj.platform === "string") {
      const normalized = normalizePlatformKey(obj.platform);
      if (normalized) obj.platform = normalized;
    }
    if (typeof obj.hashtags === "string") {
      obj.hashtags = obj.hashtags
        .split(/[\s,]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(obj.hashtags)) {
      obj.hashtags = obj.hashtags.map((h: unknown) => String(h));
    }
    if (!obj.headline) {
      obj.headline =
        obj.posterProductionPlan?.artDirection?.graphicPosterLayout?.mainHeadline ||
        "Özel İçerik";
    }
    if (!obj.hookText) {
      obj.hookText = obj.headline;
    }
    if (!obj.caption) {
      if (Array.isArray(obj.threadTweets) && obj.threadTweets.length > 0) {
        obj.caption = String(obj.threadTweets[0]);
      } else {
        obj.caption = obj.headline || "";
      }
    }
    if (!obj.callToAction) {
      obj.callToAction = "Detaylar için profilimizi inceleyin.";
    }
    if (!obj.formatDecision) {
      obj.formatDecision = {
        formatType: obj.posterProductionPlan
          ? "EDITORIAL_POSTER"
          : obj.videoProductionPlan
          ? "VERTICAL_VIDEO"
          : "COMMUNITY_POST",
        aspectRatio: "9:16",
        emotionalTone: "FOCUSED_CLARITY",
        strategicRationale: "Platform dinamiklerine uygun format",
      };
    }
    return obj;
  }
  return val;
}, z.object({
  platform: z.enum(TOPRAK_PLATFORMS),
  formatDecision: z.object({
    formatType: ContentFormatTypeSchema,
    aspectRatio: z.string().default("9:16"),
    emotionalTone: z.string().default("FOCUSED_CLARITY"),
    strategicRationale: z.string().default("Stratejik platform uyumu"),
  }),
  headline: z.string(),
  hookText: z.string(),
  caption: z.string(),
  hashtags: z.array(z.string()).default([]),
  callToAction: z.string(),
  videoProductionPlan: VideoProductionPlanSchema.optional(),
  posterProductionPlan: PosterProductionPlanSchema.optional(),
  carouselProductionPlan: CarouselProductionPlanSchema.optional(),
  threadTweets: ThreadTweetsSchema,
}));

const PlatformsRecordSchema = z.preprocess((val: unknown) => {
  const normalizedRecord: Record<string, unknown> = {};
  if (Array.isArray(val)) {
    for (const item of val) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const normKey = normalizePlatformKey(String(rec.platform ?? ""));
        if (normKey) {
          normalizedRecord[normKey] = { ...rec, platform: normKey };
        }
      }
    }
    return normalizedRecord;
  }
  if (val && typeof val === "object") {
    for (const [rawKey, rawVal] of Object.entries(val as Record<string, unknown>)) {
      const normKey = normalizePlatformKey(rawKey);
      if (normKey && rawVal && typeof rawVal === "object") {
        normalizedRecord[normKey] = {
          ...(rawVal as Record<string, unknown>),
          platform: normKey,
        };
      }
    }
    return normalizedRecord;
  }
  return val;
}, z.record(z.enum(TOPRAK_PLATFORMS), PlatformMasterProductionSchema));

export const FullProductionPackageSchema = z.object({
  brandName: z.string().default(""),
  brandSlug: z.string().default(""),
  campaignTopic: z.string().default(""),
  platforms: PlatformsRecordSchema,
});

export type PlatformMasterProduction = z.infer<typeof PlatformMasterProductionSchema>;
export type FullProductionPackage = z.infer<typeof FullProductionPackageSchema>;

export interface GenerateCopyOptions {
  brand: BrandProfile | BrandKnowledge;
  sourceText: string;
  sourceTopic?: string;
  targetPlatforms?: ToprakPlatform[];
  trendIdea?: TrendIdeaDeep;
}

const PLATFORM_SPECIFIC_RULES: Record<ToprakPlatform, string> = {
  instagram:
    "Instagram: ZORUNLU 'VERTICAL_VIDEO' (9:16 REELS) ve eksiksiz 'videoProductionPlan' (scenes + voiceover + voiceDirection + onScreenText) kurgula. Kancayı ilk satırda ver, 3-5 niş hashtag ekle.",
  tiktok:
    "TikTok: ZORUNLU 'VERTICAL_VIDEO' (9:16) ve eksiksiz 'videoProductionPlan' (scenes + voiceover + onScreenText) üret. İlk 2 saniyede merak uyandıran konuşma kancasıyla başla, samimi ve dinamik ol.",
  youtube:
    "YouTube Shorts: ZORUNLU 'VERTICAL_VIDEO' (9:16) ve 'videoProductionPlan' üret. 'headline' alanı Shorts başlığıdır ve KESİNLİKLE 90 karakteri geçmemelidir.",
  x:
    "X (Twitter): Format 'X_THREAD'. 'threadTweets' dizisinde BİRBİRİNDEN BAĞIMSIZ, TEK BAŞINA ANLAMLI 3 AYRI X GÖNDERİSİ (Slayt 1, Slayt 2, Slayt 3) üret! Başlarına KESİNLİKLE '1/', '2/', '3/' gibi sıra numarası KOYMA çünkü her biri X'te ayrı ayrı tekil gönderi olarak paylaşılacaktır. Her bir gönderi KESİNLİKLE 250 karakterin altında olmalı ve 1-2 etiketi geçmemelidir.",
  threads:
    "Threads: Samimi, sohbet başlatan tekil düşünce akışı. 'caption' toplam uzunluğu KESİNLİKLE 450 karakterin altında olmalıdır.",
  facebook:
    "Facebook: Format 'EDITORIAL_POSTER' (4:5) + 'posterProductionPlan'. Topluluk etkileşimi ve yorum tetikleyen sıcak, hikaye odaklı açıklama yaz.",
  linkedin:
    "LinkedIn: Format 'COMMUNITY_POST' veya 'EDITORIAL_POSTER'. Sektörel içgörü, profesyonel otorite ve somut çıkarım sunan paragraf yapısı kur; en fazla 3 kurumsal hashtag kullan.",
  pinterest:
    "Pinterest: Format 'EDITORIAL_POSTER' (9:16) + 'posterProductionPlan'. Aranabilir anahtar kelimeli başlık (<=90 kr) ve ilham verici açıklama üret.",
  reddit:
    "Reddit: Format 'COMMUNITY_POST'. Reklam kokmayan, doğrudan bilgi/deneyim paylaşan topluluk dili kullan. KESİNLİKLE hashtag kullanma ('hashtags': []).",
  github:
    "GitHub: Format 'COMMUNITY_POST'. Teknik netlik, sürüm/özellik özeti ve geliştirici odaklı sade dil kullan.",
};

export class CopywriterAgent {
  private static normalizeBrand(brandInput: BrandProfile | BrandKnowledge | string): BrandKnowledge {
    if (typeof brandInput === "string") {
      const cached = BrandKnowledgeStore.getBrand(brandInput);
      if (!cached) {
        throw new Error(`[CopywriterAgent] '${brandInput}' markası hafızada bulunamadı!`);
      }
      return cached;
    }
    if ("consumerPainPoints" in brandInput) {
      return brandInput;
    }
    const cached = BrandKnowledgeStore.getBrand(brandInput.slug);
    if (cached) {
      if (brandInput.healthyPlatforms?.length) {
        cached.healthyPlatforms = brandInput.healthyPlatforms;
      }
      return cached;
    }
    return {
      id: brandInput.id,
      slug: brandInput.slug,
      name: brandInput.name,
      websiteUrl: "",
      primaryColor: brandInput.primaryColor || "#3b82f6",
      accentColor: brandInput.accentColor || "#60a5fa",
      defaultLanguage: brandInput.defaultLanguage || "tr",
      healthyPlatforms: brandInput.healthyPlatforms,
      sector: brandInput.sector,
      tagline: brandInput.name,
      mission: "",
      valueProposition: brandInput.sector,
      targetAudience: brandInput.targetAudience,
      toneOfVoice: brandInput.toneOfVoice,
      coreProducts: [],
      mainCompetitors: [],
      consumerPainPoints: [],
      contentPillars: brandInput.contentAngles || [],
      hashtags: brandInput.hashtags || [],
      bannedWords: brandInput.bannedWords || [],
      lastSyncedAt: new Date().toISOString(),
    };
  }

  /**
   * 6 KİŞİLİK YARATICI VE SİNEMATOGRAFİK KONSEY İLE ÇOKLU PLATFORM ÜRETİM PAKETİ OLUŞTURUR.
   * Merkezi AI Hub (COPYWRITER_AGENT) kullanır; hata durumunda asla başka bir markanın sahte metnine düşmez.
   */
  static async createProductionPackage(
    brandInput: BrandProfile | BrandKnowledge | string,
    topicOrTrend: string | TrendIdeaDeep,
    options: { targetPlatforms?: ToprakPlatform[]; scenario?: ScenarioDefinition } = {}
  ): Promise<FullProductionPackage> {
    const brand = this.normalizeBrand(brandInput);

    const targetPlatforms: ToprakPlatform[] =
      options.targetPlatforms && options.targetPlatforms.length > 0
        ? options.targetPlatforms
        : (brand.healthyPlatforms as ToprakPlatform[]);

    if (!targetPlatforms || targetPlatforms.length === 0) {
      throw new Error(
        `[CopywriterAgent] "${brand.name}" markası için hedef HEALTHY platform listesi boş!`
      );
    }

    let topicStr = "";
    let trendContext = "";
    if (typeof topicOrTrend === "string") {
      topicStr = topicOrTrend;
    } else {
      topicStr = topicOrTrend.trendTitle;
      trendContext = `
# STRATEJİK TREND İSTİHBARATI (TREND AGENT ÇIKTISI)
- Trend Başlığı: ${topicOrTrend.trendTitle}
- Pazar İçgörüsü: ${topicOrTrend.marketInsight}
- Hedef Duygu: ${topicOrTrend.targetEmotion}
- Kanca Seçenekleri:
  * Zıt Görüş: ${topicOrTrend.hookVariations.contrarian}
  * Merak Boşluğu: ${topicOrTrend.hookVariations.curiosityGap}
  * Tüketici Acısı: ${topicOrTrend.hookVariations.painPoint}
- Önerilen Hikaye Omurgası: ${topicOrTrend.suggestedAngle}
- Rakip Ayrışması: ${topicOrTrend.competitorAdvantage}`;
    }

    const scenarioContext = options.scenario
      ? `
# AKTİF ETKİNLİK & FİZİKSEL SAHNE SENARYOSU (ZORUNLU ODAK)
- Seçilen Etkinlik / Yaşam Anı: ${options.scenario.titleTr}
- Zorunlu Metin & Seslendirme Odağı: ${options.scenario.copyFocusTr}
- Sahne & Fiziksel Aksiyon Rehberi (İngilizce): Environment: ${options.scenario.environmentEn} | Action: ${options.scenario.actionChoreographyEn}
- ÖNEMLİ: Açıklamalar, X slaytları, sahne aksiyonları ve Türkçe seslendirme metni doğrudan bu "${options.scenario.titleTr}" deneyimini yaşatmalıdır.`
      : "";

    const wisdom = LearningEngine.getWisdomForBrand(brand.slug);
    const platformRulesBlock = targetPlatforms
      .map((p) => `- ${PLATFORM_SPECIFIC_RULES[p]}`)
      .join("\n");

    console.log(`[Toprak CopywriterAgent] 🎬 6'lı Yaratıcı Konsey Toplandı: ${brand.name}`);
    console.log(`[Toprak CopywriterAgent] 🎯 Hedef HEALTHY Platformlar: [${targetPlatforms.join(", ")}]`);

    const systemInstruction = `Sen "${brand.name}" markası (${brand.sector}) için çalışan 6 kişilik elit bir Transmedya Yaratıcı Yönetmen ve Metin Konseyisin:
1. Sinematograf & Görüntü Yönetmeni (DoP): Lens, kamera hareketi, aydınlatma ve sahne aksiyonunu tasarlar.
2. Editoryal Fotoğrafçı & Afiş Sanat Yönetmeni: Statik afişler için kompozisyon, ışık, renk paleti (${brand.primaryColor}, ${brand.accentColor}) ve İngilizce görsel promptu üretir.
3. Dramaturg & Ritim Yönetmeni: Saniyelik duygu geçişlerini ve seslendirme hızını (saniyede en fazla 2.5 kelime) dengeler.
4. Nöro-Metin Yazarı & Marka Sesi Gardiyanı: "${brand.toneOfVoice}" tonunu korur.
5. Carousel & Bilgi Mimarı: Kaydırmalı anlatım hiyerarşisini kurar.
6. Platform Algoritma & Format Şefi: Her platforma ÖZGÜ, kopyala-yapıştır OLMAYAN içerik uyarlar.

KESİN KURALLAR:
- YALNIZCA "${brand.name}" markasının kendi sektörüne (${brand.sector}) ve konusuna sadık kal!
- ASLA yapay zeka klişeleri kullanma ("Günümüz dünyasında", "Dijital çağda", "Gelin birlikte bakalım", "Unutmayın ki", "Harika bir deneyim", "Sizi bekliyor", "Adım atın", "Keşfetmeye hazır mısınız", "Hayatınızı kolaylaştıracak", "Vazgeçilmeziniz olacak", "Büyüleyici bir yolculuk").
- Yasaklı kelimeleri KESİNLİKLE kullanma: ${brand.bannedWords.join(", ") || "Yok"}.
- Girişte "Merhaba arkadaşlar" gibi selamlamalarla vakit kaybetme; ilk cümlede doğrudan kancaya gir.
- ZAMAN VAADİ VE İSTATİSTİK KURALI (ÇOK ÖNEMLİ): Metinlerde, başlıklarda veya seslendirmede KESİNLİKLE "3 saniyede", "15 saniyede", "10 saniyede", "saniyeler içinde" gibi abartılı/kesin saniye vaatleri veya doğrulanmamış istatistikler KULLANMA! Bunun yerine her zaman "dakikalar içinde", "kısa sürede", "zahmetsizce" gibi gerçekçi ve güven veren ifadeler kullan.
- WEB ADRESİ KURALI: Metin içinde web adresi geçecekse ASLA büyük harfle veya yanlış uzantıyla yazma; www ve https:// olmadan küçük harflerle resmi adresi kullan (${brand.slug === "modena" ? "modenamoda.com.tr ve lappsoft.com/projects/modena" : brand.websiteUrl.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "").toLowerCase() || "lappsoft.com"}).
- SESLENDİRME VE TÜRKÇE FONETİK KURALI: Sahne 'voiceover.text' alanında normal Türkçe yazımı koru (örn. "Modena AI", "AR"). Ancak 'videoProductionPlan.voiceDirection.voiceoverPhoneticTr' alanına aynı seslendirmenin TÜRKÇE SPİKER OKUNUŞUNU yaz: "AI" kısaltmasını "A-İ" olarak (ve eklerini ince ünlü uyumuna göre: "AI'ın" yerine "A-İ'nin", "AI'ı" yerine "A-İ'yi"), "AR" -> "A-R", "%" -> "yüzde" şeklinde telaffuza uygun yaz ve cümle geçişlerine doğal nefes durakları (<short pause>) yerleştir.
- SES DUYGU YÖNETİMİ: 'videoProductionPlan.voiceDirection.speechStyleDirective' alanına bu içeriğin duygusuna ve markanın ruhuna özel İngilizce ses oyunculuğu/tonlama direktifi yaz (robotik olmayan, sıcak, canlı, ilk cümlede merak uyandıran ~148 kelime/dk doğal İstanbul Türkçesi).
- Her platformun metni ve formatı o platformun kültür ve karakter sınırına özel yazılmalıdır:
${platformRulesBlock}
- Yanıtını YALNIZCA geçerli bir JSON nesnesi olarak döndür.`;

    const prompt = `# MARKA DNA
- Marka Adı: ${brand.name}
- Sektör: ${brand.sector}
- Slogan: ${brand.tagline}
- Değer Önerisi: ${brand.valueProposition}
- Hedef Kitle: ${brand.targetAudience}
- Konuşma Tonu: ${brand.toneOfVoice}
- Ürün/Özellikler: ${brand.coreProducts.join(" | ") || brand.sector}
- Varsayılan Etiketler: ${brand.hashtags.join(", ")}
- Yasaklı Kelimeler: ${brand.bannedWords.join(", ") || "Yok"}

# ÖĞRENME MOTORU REHBERİ
- Yazar Direktifi: ${wisdom.councilDirectives.copywriterGuidance}

# KONU / HAM İÇERİK
"""
${topicStr}
"""
${trendContext}${scenarioContext}

# ÜRETİLECEK HEDEF PLATFORMLAR: ${targetPlatforms.join(", ")}

Lütfen listedeki HER BİR platform (${targetPlatforms.join(", ")}) için eksiksiz JSON üretim paketi döndür:
{
  "brandName": "${brand.name}",
  "brandSlug": "${brand.slug}",
  "campaignTopic": "${topicStr.slice(0, 90).replace(/"/g, "'")}",
  "platforms": {
    ${targetPlatforms
      .map((p) => this.buildPlatformSchemaSnippet(brand, p))
      .join(",\n    ")}
  }
}`;

    const res = await ToprakAiHub.dispatch({
      agentRole: "COPYWRITER_AGENT",
      systemInstruction,
      prompt,
      jsonMode: true,
    });

    console.log(`[Toprak CopywriterAgent] ✅ Model yanıtladı: ${res.provider}/${res.modelUsed} (${res.durationMs}ms)`);
    const parsed = JSON.parse(res.text);
    const pkg = FullProductionPackageSchema.parse(parsed);
    pkg.brandName = pkg.brandName || brand.name;
    pkg.brandSlug = pkg.brandSlug || brand.slug;
    pkg.campaignTopic = pkg.campaignTopic || topicStr.slice(0, 90);

    const missingPlatforms = targetPlatforms.filter((p) => !pkg.platforms[p]);
    if (missingPlatforms.length > 0) {
      await this.fillMissingPlatforms(
        pkg,
        brand,
        systemInstruction,
        topicStr,
        trendContext,
        missingPlatforms
      );
    }

    return this.postProcessPackage(pkg, brand, targetPlatforms);
  }

  private static buildPlatformSchemaSnippet(brand: BrandKnowledge, p: ToprakPlatform): string {
    const defaultFmt =
      p === "x"
        ? "X_THREAD"
        : p === "facebook" || p === "pinterest"
        ? "EDITORIAL_POSTER"
        : p === "linkedin" || p === "reddit" || p === "github" || p === "threads"
        ? "COMMUNITY_POST"
        : "VERTICAL_VIDEO";
    const defaultRatio =
      p === "x" ? "16:9" : p === "facebook" || p === "linkedin" ? "4:5" : "9:16";
    return `"${p}": {
      "platform": "${p}",
      "formatDecision": {
        "formatType": "${defaultFmt}",
        "aspectRatio": "${defaultRatio}",
        "emotionalTone": "Merak -> Aydınlanma -> Güven",
        "strategicRationale": "${p} algoritmasına özel gerekçe"
      },
      "headline": "${p === "youtube" ? "En fazla 90 karakterlik çarpıcı Shorts başlığı" : "Vurucu kapak/gönderi başlığı"}",
      "hookText": "İlk 3 saniyede yakalayan kanca cümlesi",
      "caption": "${p === "x" ? "260 karakteri geçmeyen net ana tweet" : p === "threads" ? "450 karakteri geçmeyen samimi Threads metni" : "Platforma özel özgün ve akıcı açıklama metni"}",
      "hashtags": ${p === "reddit" ? "[]" : `["#${brand.slug}"]`},
      "callToAction": "Markaya uygun net eylem çağrısı"${
        defaultFmt === "VERTICAL_VIDEO"
          ? `,
      "videoProductionPlan": {
        "overallDurationSec": 20,
        "overallEmotionalArc": "Merak -> Çözüm -> Özgüven",
        "audioDesign": { "musicTrackStyle": "Marka ruhuna uygun modern altyapı", "soundEffects": ["Whoosh"] },
        "voiceDirection": {
          "voiceoverPhoneticTr": "Sahnelerdeki seslendirmenin spiker okunuşlu hali (örn: Modena A-İ, A-İ'nin, A-R) ve <short pause> nefes durakları",
          "speechStyleDirective": "Expressive, warm, natural Istanbul Turkish voiceover acting direction matching the hook and brand mood (~148 WPM)",
          "emotionPreset": "EXCITED_INSPIRING"
        },
        "scenes": [
          {
            "timeRange": "00:00 - 00:05",
            "sceneMood": "HOOK_TENSION",
            "cinematography": {
              "cameraRig": "Gimbal push-in",
              "lensAndFocal": "35mm f/1.8",
              "lightingAndAtmosphere": "Doğal sinematik ışık",
              "actionChoreography": "Sahne eylemi"
            },
            "onScreenText": { "text": "KISA EKRAN YAZISI", "typographyStyle": "Bold Sans", "screenPosition": "Center" },
            "voiceover": { "text": "En fazla 10-12 kelimelik doğal Türkçe seslendirme cümlesi.", "speakingPace": "Akıcı" }
          },
          {
            "timeRange": "00:05 - 00:15",
            "sceneMood": "SOLUTION_CLARITY",
            "cinematography": {
              "cameraRig": "Smooth tracking",
              "lensAndFocal": "50mm f/1.8",
              "lightingAndAtmosphere": "Sıcak net aydınlatma",
              "actionChoreography": "Ürün/çözüm etkileşimi"
            },
            "onScreenText": { "text": "ÇÖZÜM VURGUSU", "typographyStyle": "Bold Sans", "screenPosition": "Center" },
            "voiceover": { "text": "Değer önerisini anlatan 15-20 kelimelik net seslendirme.", "speakingPace": "Güven veren" }
          }
        ]
      }`
          : ""
      }${
        defaultFmt === "EDITORIAL_POSTER"
          ? `,
      "posterProductionPlan": {
        "conceptTitle": "Kampanya Afiş Konsepti",
        "aspectRatio": "${defaultRatio === "9:16" ? "9:16" : "4:5"}",
        "targetEmotion": "Güven ve Merak",
        "artDirection": {
          "compositionAndFraming": "Üstte tipografi boşluğu bırakan modern kompozisyon",
          "lightingAndMood": "Doğal stüdyo ışığı",
          "colorPalette": ["${brand.primaryColor}", "${brand.accentColor}"],
          "graphicPosterLayout": {
            "mainHeadline": "Afiş Ana Başlığı",
            "subHeadline": "Alt Başlık",
            "badgeOrTagText": "${brand.name}",
            "logoPlacement": "Alt Orta",
            "fontVibe": "Modern Sans"
          },
          "imageGenPrompt": {
            "masterPromptEn": "High-end commercial photography in English matching ${brand.sector}",
            "negativePrompt": "blurry, deformed, watermark, text",
            "styleKeywords": ["editorial", "8k"]
          }
        }
      }`
          : ""
      }${
        p === "x"
          ? `,
      "threadTweets": [
        "Numarasız (1/ olmadan), tek başına anlamlı ve çarpıcı 1. bağımsız X gönderisi (<=250 kr)",
        "Numarasız (2/ olmadan), somut değer/içgörü sunan 2. bağımsız X gönderisi (<=250 kr)",
        "Numarasız (3/ olmadan), harekete geçirici 3. bağımsız X gönderisi (<=250 kr)"
      ]`
          : ""
      }
    }`;
  }

  private static async fillMissingPlatforms(
    pkg: FullProductionPackage,
    brand: BrandKnowledge,
    systemInstruction: string,
    topicStr: string,
    trendContext: string,
    missingPlatforms: ToprakPlatform[]
  ): Promise<void> {
    console.log(
      `[Toprak CopywriterAgent] ⚠️ İlk yanıtta eksik kalan platformlar tamamlanıyor: [${missingPlatforms.join(", ")}]`
    );

    const followUpPrompt = `# EKSİK PLATFORM TAMAMLAMA GÖREVİ
Marka: ${brand.name} (${brand.sector})
Konu: """${topicStr}"""
${trendContext}

Aşağıdaki platform(lar) ilk pakette eksik kaldı. SADECE şu platform(lar) için eksiksiz JSON döndür: ${missingPlatforms.join(", ")}
{
  "brandName": "${brand.name}",
  "brandSlug": "${brand.slug}",
  "campaignTopic": "${pkg.campaignTopic.replace(/"/g, "'")}",
  "platforms": {
    ${missingPlatforms.map((p) => this.buildPlatformSchemaSnippet(brand, p)).join(",\n    ")}
  }
}`;

    const res = await ToprakAiHub.dispatch({
      agentRole: "COPYWRITER_AGENT",
      systemInstruction,
      prompt: followUpPrompt,
      jsonMode: true,
    });

    const parsed = JSON.parse(res.text);
    const partialPkg = FullProductionPackageSchema.parse(parsed);
    for (const mp of missingPlatforms) {
      if (partialPkg.platforms[mp]) {
        pkg.platforms[mp] = partialPkg.platforms[mp];
      }
    }
  }

  /**
   * Denetçi Ajan (ValidatorAgent) ihlal veya revizyon bildirdiğinde paketi geri bildirimle düzeltir (1-Pass Revision Loop).
   */
  static async reviseProductionPackage(
    brandInput: BrandProfile | BrandKnowledge | string,
    previousPackage: FullProductionPackage,
    validationReport: ValidationReport,
    targetPlatforms: ToprakPlatform[]
  ): Promise<FullProductionPackage> {
    const brand = this.normalizeBrand(brandInput);
    console.log(
      `[Toprak CopywriterAgent] 🔄 Denetçi geri bildirimiyle revizyon yapılıyor (${validationReport.violations.length} ihlal, ${validationReport.actionableRevisions.length} öneri)...`
    );

    const systemInstruction = `Sen "${brand.name}" markasının Baş Editörü ve Revizyon Uzmanısın.
Denetim Konseyi'nin tespit ettiği TÜM kural ihlallerini ve revizyon notlarını eksiksiz gidererek üretim paketini kusursuz hale getir.
- Yasaklı kelimeleri (${brand.bannedWords.join(", ") || "Yok"}) ve tüm yapay zeka klişelerini tamamen temizle.
- X tweetlerini <=260 karakter, Threads metnini <=450 karakter, YouTube başlığını <=90 karakter sınırında tut, Reddit'te hashtag bırakma.
- JSON şemasını ve tüm platform anahtarlarını (${targetPlatforms.join(", ")}) aynen koru. YALNIZCA geçerli JSON döndür.`;

    const prompt = `# DENETÇİ RAPORU (MUTLAKA DÜZELTİLECEK NOKTALAR)
- Mevcut Skor: ${validationReport.overallScore}/100 (${validationReport.status})
- Kritik İhlaller:
${validationReport.violations.map((v) => `  * ${v}`).join("\n") || "  * Yok"}
- Somut Revizyon Talepleri:
${validationReport.actionableRevisions.map((r) => `  * ${r}`).join("\n") || "  * Yok"}
- Heyet Notu: ${validationReport.improvementNotes}

# MEVCUT ÜRETİM PAKETİ (JSON):
${JSON.stringify(previousPackage)}

Lütfen tüm sorunları giderilmiş tam JSON paketini döndür.`;

    const res = await ToprakAiHub.dispatch({
      agentRole: "COPYWRITER_AGENT",
      systemInstruction,
      prompt,
      jsonMode: true,
      temperatureOverride: 0.45,
    });

    const parsed = JSON.parse(res.text);
    const pkg = FullProductionPackageSchema.parse(parsed);
    pkg.brandName = pkg.brandName || previousPackage.brandName || brand.name;
    pkg.brandSlug = pkg.brandSlug || previousPackage.brandSlug || brand.slug;
    pkg.campaignTopic = pkg.campaignTopic || previousPackage.campaignTopic;

    for (const p of targetPlatforms) {
      if (!pkg.platforms[p] && previousPackage.platforms[p]) {
        pkg.platforms[p] = previousPackage.platforms[p];
      }
    }

    return this.postProcessPackage(pkg, brand, targetPlatforms);
  }

  /**
   * FullProductionPackage nesnesini PlatformContent haritasına dönüştürür (ikinci bir LLM çağrısı yapmadan).
   */
  static toPlatformContents(
    fullPackage: FullProductionPackage,
    targetPlatforms: ToprakPlatform[]
  ): Record<ToprakPlatform, PlatformContent> {
    const result: Partial<Record<ToprakPlatform, PlatformContent>> = {};

    for (const p of targetPlatforms) {
      const prod = fullPackage.platforms[p];
      if (!prod) continue;

      const videoScript = prod.videoProductionPlan
        ? {
            visualCues: prod.videoProductionPlan.scenes.map(
              (s) =>
                `[${s.timeRange}] ${s.cinematography.cameraRig} (${s.cinematography.lensAndFocal}) - ${s.cinematography.actionChoreography}`
            ),
            onScreenTexts: prod.videoProductionPlan.scenes
              .map((s) => s.onScreenText.text)
              .filter(Boolean),
            voiceoverText: prod.videoProductionPlan.scenes
              .map((s) => s.voiceover.text)
              .filter(Boolean)
              .join(" "),
            voiceoverPhoneticTr:
              prod.videoProductionPlan.voiceDirection?.voiceoverPhoneticTr || undefined,
            speechStyleDirective:
              prod.videoProductionPlan.voiceDirection?.speechStyleDirective || undefined,
            emotionPreset:
              prod.videoProductionPlan.voiceDirection?.emotionPreset || undefined,
          }
        : undefined;

      result[p] = {
        platform: p,
        headline: prod.headline,
        caption: prod.caption,
        hashtags: prod.hashtags,
        hookText: prod.hookText,
        callToAction: prod.callToAction,
        videoScript,
        characterCount: prod.caption.length,
      };
    }

    return result as Record<ToprakPlatform, PlatformContent>;
  }

  /**
   * Geriye dönük uyumluluk metodu.
   */
  static async generatePlatformCopies(
    opts: GenerateCopyOptions
  ): Promise<Record<ToprakPlatform, PlatformContent>> {
    const platforms =
      opts.targetPlatforms && opts.targetPlatforms.length > 0
        ? opts.targetPlatforms
        : (opts.brand.healthyPlatforms as ToprakPlatform[]);

    const fullPackage = await this.createProductionPackage(
      opts.brand,
      opts.trendIdea || opts.sourceText,
      { targetPlatforms: platforms }
    );

    return this.toPlatformContents(fullPackage, platforms);
  }

  /**
   * Platform karakter sınırlarını ve eksik hashtag/alan kurallarını son kez garanti altına alır.
   */
  private static postProcessPackage(
    pkg: FullProductionPackage,
    brand: BrandKnowledge,
    targetPlatforms: ToprakPlatform[]
  ): FullProductionPackage {
    for (const p of targetPlatforms) {
      const item = pkg.platforms[p];
      if (!item) {
        throw new Error(
          `[CopywriterAgent] Model yanıtında "${p}" platformu eksik döndü.`
        );
      }

      // Yazılı metinlerde her zaman kurumsal "AI" / "AR" yazımını koru ("A-İ" yalnızca ses motorunda kullanılır)
      item.headline = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(item.headline);
      item.caption = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(item.caption);
      item.hookText = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(item.hookText);
      item.callToAction = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(item.callToAction);
      if (item.threadTweets && item.threadTweets.length > 0) {
        item.threadTweets = item.threadTweets.map((t) =>
          TurkishPhoneticNormalizer.toWrittenDisplayTurkish(t)
        );
      }
      if (item.videoProductionPlan?.voiceDirection?.voiceoverPhoneticTr) {
        item.videoProductionPlan.voiceDirection.voiceoverPhoneticTr =
          TurkishPhoneticNormalizer.sanitizeTimeClaimsTr(
            item.videoProductionPlan.voiceDirection.voiceoverPhoneticTr
          );
      }
      if (item.videoProductionPlan?.scenes) {
        for (const sc of item.videoProductionPlan.scenes) {
          sc.voiceover.text = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(
            sc.voiceover.text
          );
          sc.onScreenText.text = TurkishPhoneticNormalizer.toWrittenDisplayTurkish(
            sc.onScreenText.text
          );
        }
      }

      if (p === "reddit") {
        item.hashtags = [];
      } else if (!item.hashtags || item.hashtags.length === 0) {
        item.hashtags = brand.hashtags.length > 0 ? brand.hashtags.slice(0, 3) : [`#${brand.slug}`];
      } else if (item.hashtags.length > 6) {
        item.hashtags = item.hashtags.slice(0, 5);
      }

      if (p === "x") {
        const stripNumberPrefix = (txt: string) =>
          txt.replace(/^\s*\d+\s*(?:\/\d*\s*|\/|\)|\.-|-)\s*/u, "").trim();

        item.caption = stripNumberPrefix(item.caption);
        if (item.threadTweets && item.threadTweets.length > 0) {
          item.threadTweets = item.threadTweets
            .map((t) => stripNumberPrefix(t))
            .filter((t) => t.length > 0)
            .map((t) => (t.length > 275 ? `${t.slice(0, 272)}...` : t));
          if (item.threadTweets.length > 0) {
            item.caption = item.threadTweets[0];
          }
        } else {
          if (item.caption.length > 275) {
            item.caption = `${item.caption.slice(0, 272)}...`;
          }
          item.threadTweets = [item.caption];
        }
      }

      if (p === "threads" && item.caption.length > 490) {
        item.caption = `${item.caption.slice(0, 487)}...`;
      }

      if (p === "youtube" && item.headline.length > 95) {
        item.headline = item.headline.slice(0, 95);
      }
    }

    return pkg;
  }
}
