import { z } from "zod";
import { ToprakAiHub } from "../core/ai-hub";
import { BrandKnowledge, BrandProfile, ToprakPlatform } from "../core/types";
import { BrandKnowledgeStore } from "../core/brand-knowledge-store";
import { LearningEngine } from "../core/learning-engine";
import { ScenarioDefinition, ScenarioManager } from "../core/scenario-manager";

// ==========================================
// 1. ŞEMA TANIMLARI
// ==========================================
export const TrendHookVariationsSchema = z.object({
  contrarian: z
    .string()
    .describe("Kışkırtıcı / Zıt Görüş: Sektördeki genel kanıya meydan okuyan durdurucu cümle."),
  curiosityGap: z
    .string()
    .describe("Merak Uyandıran / İçeriden Bilgi: İzleyicide 'Ben bunu neden bilmiyordum?' dedirten kanca."),
  painPoint: z
    .string()
    .describe("Tüketici Acısına Dokunan: Kullanıcının günlük hayatta yaşadığı somut bir sorunu vuran kanca."),
});

export const TrendFormatSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    const upper = val.toUpperCase().trim();
    if (upper.includes("TIKTOK")) return "TIKTOK";
    if (upper.includes("THREAD") || upper === "X") return "X_THREAD";
    if (upper.includes("REEL")) return "REELS";
    if (upper.includes("SHORT") || upper.includes("YOUTUBE")) return "SHORT_VIDEO";
    if (upper.includes("FACEBOOK") || upper.includes("FB")) return "FACEBOOK_POST";
    if (upper.includes("LINKEDIN")) return "LINKEDIN_POST";
    if (upper.includes("PINTEREST") || upper.includes("PIN")) return "PINTEREST_PIN";
    if (upper.includes("REDDIT")) return "REDDIT_POST";
    if (upper.includes("CAROUSEL")) return "CAROUSEL";
    if (upper.includes("TEXT") || upper.includes("POST")) return "TEXT_POST";
  }
  return "REELS";
}, z.enum([
  "REELS",
  "TIKTOK",
  "SHORT_VIDEO",
  "X_THREAD",
  "FACEBOOK_POST",
  "LINKEDIN_POST",
  "PINTEREST_PIN",
  "REDDIT_POST",
  "CAROUSEL",
  "TEXT_POST",
]).default("REELS"));

export const TrendIdeaDeepSchema = z.object({
  trendTitle: z.string().describe("Trendin / İçerik Fikrinin çarpıcı başlığı"),
  marketInsight: z.string().describe("Rakiplerin kaçırdığı pazar açığı veya tüketici içgörüsü (Neden şimdi?)"),
  targetEmotion: z.string().describe("Tetiklenen duygu (Merak, Rahatlama, Statü, Tasarruf, Aydınlanma)"),
  targetPlatform: z.string().describe("Bu fikrin optimize edildiği bağlı ve sağlıklı sosyal medya platformu"),
  hookVariations: TrendHookVariationsSchema,
  suggestedAngle: z.string().describe("İçeriğin işleyeceği ana omurga ve değer önerisi"),
  competitorAdvantage: z.string().describe("Bu fikrin markayı rakiplerinden nasıl ayrıştırdığı"),
  suggestedFormat: TrendFormatSchema,
  keywords: z.array(z.string()).default([]),
});

export const TrendIntelligenceReportSchema = z.object({
  brandName: z.string(),
  brandSlug: z.string(),
  healthyPlatforms: z.array(z.string()),
  marketSnapshot: z.object({
    sectorOverview: z.string(),
    globalVsTurkeyDynamics: z.string(),
    competitorGaps: z.array(z.string()).default([]),
    consumerContradictions: z.array(z.string()).default([]),
  }),
  ideas: z.array(TrendIdeaDeepSchema).min(1),
});

export type TrendIdeaDeep = z.infer<typeof TrendIdeaDeepSchema>;
export type TrendIntelligenceReport = z.infer<typeof TrendIntelligenceReportSchema>;

export interface TrendIdea {
  headline: string;
  hook: string;
  angleDescription: string;
  suggestedFormat: "REELS" | "CAROUSEL" | "SHORT_VIDEO" | "TEXT_POST";
  keywords: string[];
}

export class TrendAgent {
  private static async normalizeBrand(
    brandInput: BrandKnowledge | BrandProfile | string,
    forceSync = false
  ): Promise<BrandKnowledge> {
    if (typeof brandInput === "string") {
      const { socialBrand, knowledge } = await BrandKnowledgeStore.resolveBrandForProduction(brandInput);
      if (forceSync) {
        return await BrandKnowledgeStore.syncBrand(socialBrand, { force: true });
      }
      return knowledge;
    }

    if ("consumerPainPoints" in brandInput) {
      return brandInput;
    }

    const cached = BrandKnowledgeStore.getBrand(brandInput.slug);
    if (cached) {
      if (brandInput.healthyPlatforms && brandInput.healthyPlatforms.length > 0) {
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
      mission: brandInput.contentAngles?.join(", ") || "",
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
   * 5'Lİ İSTİHBARAT KONSEYİ İLE DERİN TREND VE FİKİR RAPORU ÜRETİR.
   * Merkezi AI Hub (TREND_AGENT) üzerinden çalışır; sahte başka marka yedeğine ASLA düşmez.
   */
  static async analyzeAndDiscoverTrends(
    brandInput: BrandKnowledge | BrandProfile | string,
    options: {
      count?: number;
      forceSync?: boolean;
      targetPlatforms?: ToprakPlatform[];
      scenario?: ScenarioDefinition;
      scenarios?: ScenarioDefinition[];
    } = {}
  ): Promise<TrendIntelligenceReport> {
    const count = options.count ?? 3;
    const brand = await this.normalizeBrand(brandInput, options.forceSync);

    const activePlatforms =
      options.targetPlatforms && options.targetPlatforms.length > 0
        ? options.targetPlatforms
        : (brand.healthyPlatforms as ToprakPlatform[]);

    if (!activePlatforms || activePlatforms.length === 0) {
      throw new Error(
        `[Toprak TrendAgent] "${brand.name}" markası için bağlı ve HEALTHY durumda hiçbir platform bulunamadı.`
      );
    }

    const healthyPlatformsStr = activePlatforms.join(", ");
    const currentDate = new Date().toISOString().slice(0, 10);
    const wisdom = LearningEngine.getWisdomForBrand(brand.slug);

    console.log(`[Toprak TrendAgent] 🕵️‍♂️ 5'li İstihbarat Konseyi Toplandı: ${brand.name} (${currentDate})`);
    console.log(`[Toprak TrendAgent] 📡 Hedef HEALTHY Platformlar: [${healthyPlatformsStr}]`);

    let scenarioDirectiveBlock = "";
    if (options.scenario) {
      scenarioDirectiveBlock = `
# AKTİF YAŞAM ANI & ETKİNLİK SENARYOSU (ZORUNLU ODAK)
- Seçilen Etkinlik / Yaşam Anı: ${options.scenario.titleTr}
- Zorunlu Konu & Sahne Odağı: ${options.scenario.copyFocusTr}
- ÖNEMLİ KURAL: Üreteceğin fikirlerin TAMAMI kesinlikle "${options.scenario.titleTr}" senaryosuna ve bu yaşam anına odaklanmalıdır!${
        options.scenario.id !== "modena_smart_closet"
          ? " Kesinlikle klasik 'yatak odasında dolu dolap karşısında beklemek' klişesine DÜŞME; karakteri doğrudan bu etkinliğin içinde veya bu etkinliğe hazırlanırken kurgula!"
          : ""
      }`;
    } else if (options.scenarios && options.scenarios.length > 0) {
      scenarioDirectiveBlock = `
# ÇAPRAZ ETKİNLİK DAĞILIMI (HER FİKİR FARKLI BİR YAŞAM ANINI İŞLEMELİDİR)
Üreteceğin ${count} fikrin her birini sırasıyla aşağıdaki farklı yaşam anlarına odakla (tek tip 'dolap' konusuna takılma):
${options.scenarios
  .map((sc, idx) => `${idx + 1}. Fikir Senaryosu — ${sc.titleTr}: ${sc.copyFocusTr}`)
  .join("\n")}`;
    }

    const systemInstruction = `Sen 5 kişilik elit bir Dijital Pazar İstihbarat ve Büyüme Konseyisin (Bugünün Tarihi: ${currentDate}):
1. Pazar & Rekabet İstihbarat Uzmanı: Rakiplerin (${brand.mainCompetitors.join(", ") || "sektördeki rakiplerin"}) söylem klişelerini ve içerik boşluklarını (Content Gap) bulur.
2. Tüketici Davranış Psikoloğu: "${brand.targetAudience}" kitlesinin günlük hayatta yaşadığı gerçek çelişkileri ve acı noktalarını çözer.
3. Kültürel Trend Tahmincisi: Güncel ${currentDate.slice(0, 4)} dijital akımlarını markanın kendi sektörüne (${brand.sector}) uyarlar.
4. Sosyal Platform Algoritma Uzmanı: SADECE bu markanın aktif ve sağlıklı platformlarına (${healthyPlatformsStr}) uygun içerik formatlarını belirler.
5. Büyüme & Kanca Mimarı: İlk 3 saniyede izleyiciyi durduran 3 farklı kanca psikolojisi (Zıt Görüş, Merak Boşluğu, Tüketici Acısı) kurar.

KESİN KURALLAR:
- YALNIZCA "${brand.name}" markasının kendi sektörüne (${brand.sector}) sadık kal. Başka bir markanın veya alakasız bir sektörün konusunu ASLA karıştırma!
- Asla "Günümüz dünyasında...", "Gelin inceleyelim..." gibi yapay zeka klişeleri kullanma.
- Başlık ve kanca önerilerinde kesinlikle "3 saniyede", "15 saniyede", "saniyeler içinde" gibi abartılı saniye vaatleri kullanma; "dakikalar içinde", "kısa sürede", "zahmetsizce" gibi gerçekçi ifadeler tercih et.
- Yasaklı kelimeleri ASLA kullanma: ${brand.bannedWords.join(", ") || "Yok"}.
- Yanıtını YALNIZCA geçerli bir JSON nesnesi olarak döndür.`;

    const prompt = `# MARKA BİLGİ BANKASI (KNOWLEDGE STORE)
- Tarih: ${currentDate}
- Marka Adı: ${brand.name}
- Sektör: ${brand.sector}
- Slogan: ${brand.tagline}
- Temel Değer Önerisi: ${brand.valueProposition}
- Hedef Kitle: ${brand.targetAudience}
- Konuşma Tonu: ${brand.toneOfVoice}
- Çekirdek Özellikler/Ürünler: ${brand.coreProducts.join(" | ") || "Belirtilmemiş"}
- Ana Rakipler: ${brand.mainCompetitors.join(" | ") || "Sektör Rakipleri"}
- Tüketici Acı Noktaları: ${brand.consumerPainPoints.join(" | ") || "Zaman kaybı ve belirsizlik"}
- İçerik Sütunları: ${brand.contentPillars.join(" | ") || brand.sector}
- Aktif & Sağlıklı Platformlar: ${healthyPlatformsStr}
- Yasaklı Kelimeler: ${brand.bannedWords.join(", ") || "Yok"}
${scenarioDirectiveBlock}

# ÖĞRENME MOTORU REHBERİ (${wisdom.totalPostsAnalyzed} gerçek gönderi analizi)
- Strateji Tavsiyesi: ${wisdom.councilDirectives.trendAgentGuidance}
${wisdom.provenWinners.length > 0 ? `- Kazanan Örüntüler: ${wisdom.provenWinners.map((w) => w.pattern).join(" | ")}` : ""}
${wisdom.underperformingWarnings.length > 0 ? `- Kaçınılacak Noktalar: ${wisdom.underperformingWarnings.map((u) => u.pattern).join(" | ")}` : ""}

# GÖREV:
"${brand.name}" markası için ${count} adet özgün, viral potansiyeli yüksek ve markanın sağlıklı platformlarına (${healthyPlatformsStr}) özel içerik ve kanca planı üret.

JSON ÇIKTI FORMATI:
{
  "brandName": "${brand.name}",
  "brandSlug": "${brand.slug}",
  "healthyPlatforms": [${activePlatforms.map((p) => `"${p}"`).join(", ")}],
  "marketSnapshot": {
    "sectorOverview": "Sektördeki güncel rekabet ve genel durum özeti",
    "globalVsTurkeyDynamics": "Dünyada yükselen ve Türkiye'ye yansıyan güncel kullanıcı alışkanlığı",
    "competitorGaps": ["Rakiplerin eksik bıraktığı somut açık 1", "Somut açık 2"],
    "consumerContradictions": ["Tüketicinin söylediği ile yaptığı arasındaki psikolojik çelişki"]
  },
  "ideas": [
    {
      "trendTitle": "Çarpıcı ve merak uyandıran fikir başlığı",
      "marketInsight": "Bu konuyu neden şimdi işlemeliyiz?",
      "targetEmotion": "Merak / Rahatlama / Özgüven vb.",
      "targetPlatform": "${activePlatforms[0]}",
      "hookVariations": {
        "contrarian": "Kışkırtıcı / Zıt Görüş kancası",
        "curiosityGap": "Merak uyandıran içeriden bilgi kancası",
        "painPoint": "Tüketicinin canını yakan problem kancası"
      },
      "suggestedAngle": "İçeriğin işleyeceği somut değer ve hikaye omurgası",
      "competitorAdvantage": "Bu içerik ${brand.name} markasını rakiplerinden nasıl ayrıştırır?",
      "suggestedFormat": "REELS",
      "keywords": ["anahtar1", "anahtar2", "anahtar3"]
    }
  ]
}`;

    const res = await ToprakAiHub.dispatch({
      agentRole: "TREND_AGENT",
      systemInstruction,
      prompt,
      jsonMode: true,
    });

    console.log(`[Toprak TrendAgent] ✅ Model yanıtladı: ${res.provider}/${res.modelUsed} (${res.durationMs}ms)`);
    const parsed = JSON.parse(res.text);
    return TrendIntelligenceReportSchema.parse(parsed);
  }

  /**
   * Basitleştirilmiş fikir listesi döndüren yardımcı metot.
   */
  static async discoverIdeas(
    brand: BrandProfile | BrandKnowledge,
    count: number = 3
  ): Promise<TrendIdea[]> {
    const distinctScenarios = ScenarioManager.peekDistinctScenarios(brand.slug, count);
    const report = await this.analyzeAndDiscoverTrends(brand, {
      count,
      scenarios: distinctScenarios.length > 0 ? distinctScenarios : undefined,
    });
    return report.ideas.map((item) => ({
      headline: item.trendTitle,
      hook: item.hookVariations.contrarian || item.hookVariations.painPoint,
      angleDescription: `${item.suggestedAngle} [Strateji: ${item.marketInsight}]`,
      suggestedFormat:
        item.suggestedFormat === "X_THREAD" || item.suggestedFormat === "TEXT_POST"
          ? "TEXT_POST"
          : "REELS",
      keywords: item.keywords,
    }));
  }
}
