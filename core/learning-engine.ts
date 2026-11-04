import fs from "node:fs";
import path from "node:path";
import { loadToprakConfig } from "./config";
import { ToprakAiHub } from "./ai-hub";
import { SocialBridge, type ToprakBridgeAnalyticsData } from "./social-bridge";
import { BrandDiscovery } from "./brand-discovery";
import { ToprakPlatform, TOPRAK_PLATFORMS } from "./types";

export type InsightCategory =
  | "HOOK"
  | "FORMAT"
  | "PACING"
  | "CASTING"
  | "COPY_LENGTH"
  | "PLATFORM";

export type PatternStatus =
  | "PROVEN_WINNER"
  | "PROMISING"
  | "NEUTRAL"
  | "UNDERPERFORMING"
  | "AVOID";

export interface PerformanceInsight {
  category: InsightCategory;
  pattern: string;
  impactScore: string;
  confidence: number;
  status: PatternStatus;
  actionableDirective: string;
}

export interface CouncilWisdomDirectives {
  trendAgentGuidance: string;
  copywriterGuidance: string;
  promptArchitectGuidance: string;
  validatorGuidance: string;
}

export interface BrandWisdom {
  brandSlug: string;
  brandName: string;
  lastAnalyzedAt: string;
  totalPostsAnalyzed: number;
  overallEngagementRate: number;
  bestPlatform: ToprakPlatform;
  bestFormat: string;
  provenWinners: PerformanceInsight[];
  underperformingWarnings: PerformanceInsight[];
  councilDirectives: CouncilWisdomDirectives;
}

interface ScoredPostItem {
  id: string;
  platform: ToprakPlatform;
  adaptedText: string;
  wordCount: number;
  hasQuestionHook: boolean;
  hasVideo: boolean;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  engagementScore: number;
  hasRealSnapshot: boolean;
}

export class LearningEngine {
  private static getMemoryDir(): string {
    const dir = path.join(loadToprakConfig().storageDir, "memory");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private static getWisdomFilePath(brandSlug: string): string {
    return path.join(this.getMemoryDir(), `${brandSlug}_wisdom.json`);
  }

  /**
   * Markanın son öğrenilmiş bilgelik hafızasını diskten okur.
   * Henüz analiz yapılmamışsa dürüst başlangıç (cold-start) rehberi döner.
   */
  static getWisdomForBrand(brandSlug: string): BrandWisdom {
    const filePath = this.getWisdomFilePath(brandSlug);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw) as BrandWisdom;
      } catch (err) {
        console.warn(
          `[Toprak LearningEngine] ⚠️ ${brandSlug} bilgelik dosyası okunamadı, başlangıç profili kullanılıyor:`,
          err
        );
      }
    }

    return this.createColdStartWisdom(brandSlug, brandSlug.toUpperCase());
  }

  /**
   * Tüm sağlıklı markalar için periyodik geri bildirim ve öğrenme döngüsünü çalıştırır.
   */
  static async syncAllQualifiedBrands(): Promise<BrandWisdom[]> {
    const qualified = await BrandDiscovery.getQualifiedBrands();
    const results: BrandWisdom[] = [];
    for (const brand of qualified) {
      try {
        const wisdom = await this.analyzeBrandPerformance(brand.slug);
        results.push(wisdom);
      } catch (err) {
        console.warn(`[Toprak LearningEngine] ${brand.slug} analizi atlandı:`, err);
      }
    }
    return results;
  }

  /**
   * Markanın Lappsoft Social üzerindeki GERÇEK yayınlanmış gönderilerini ve analitik metriklerini okur,
   * istatistiksel kırılımları hesaplar ve Merkezi AI Hub (LEARNING_ENGINE) ile ajan tavsiyelerine dönüştürür.
   * Asla sahte veri (seed) basmaz ve olmayan istatistik uydurmaz.
   */
  static async analyzeBrandPerformance(brandSlug: string): Promise<BrandWisdom> {
    console.log(
      `[Toprak LearningEngine] 🧠 Gerçek Performans ve Öğrenme Analizi Başlatılıyor: "${brandSlug}"`
    );

    const data: ToprakBridgeAnalyticsData = await SocialBridge.getBrandAnalytics(brandSlug);
    if (!data.workspaceFound) {
      return this.getWisdomForBrand(brandSlug);
    }

    // Henüz yayınlanmış gerçek gönderi yoksa sahte rakam uydurmadan dürüst cold-start profili kaydet
    if (data.publishedDeliveries.length === 0) {
      const coldWisdom = this.createColdStartWisdom(brandSlug, data.brandName || brandSlug.toUpperCase());
      this.persistWisdom(brandSlug, coldWisdom);
      console.log(
        `[Toprak LearningEngine] ℹ️ "${data.brandName}" için henüz yayınlanmış gönderi yok (Cold-Start rehberi aktif).`
      );
      return coldWisdom;
    }

    const scored = this.scoreRealDeliveries(data);
    const itemsWithMetrics = scored.filter((s) => s.impressions > 0);
    const effectiveList = itemsWithMetrics.length > 0 ? itemsWithMetrics : scored;

    const avgEngagement =
      effectiveList.reduce((acc, item) => acc + item.engagementScore, 0) /
      Math.max(1, effectiveList.length);

    // Platform bazlı ortalama etkileşim
    const platformTotals = new Map<ToprakPlatform, { sum: number; count: number }>();
    for (const item of effectiveList) {
      const prev = platformTotals.get(item.platform) || { sum: 0, count: 0 };
      platformTotals.set(item.platform, {
        sum: prev.sum + item.engagementScore,
        count: prev.count + 1,
      });
    }

    let bestPlatform: ToprakPlatform = effectiveList[0]?.platform || "instagram";
    let bestPlatformAvg = -1;
    const platformBreakdown: Record<string, { posts: number; avgScore: number }> = {};

    for (const [plat, stat] of platformTotals.entries()) {
      const avg = Number((stat.sum / stat.count).toFixed(2));
      platformBreakdown[plat] = { posts: stat.count, avgScore: avg };
      if (avg > bestPlatformAvg) {
        bestPlatformAvg = avg;
        bestPlatform = plat;
      }
    }

    // Video vs Statik karşılaştırması
    const videoItems = effectiveList.filter((i) => i.hasVideo);
    const staticItems = effectiveList.filter((i) => !i.hasVideo);
    const videoAvg =
      videoItems.length > 0
        ? videoItems.reduce((a, b) => a + b.engagementScore, 0) / videoItems.length
        : 0;
    const staticAvg =
      staticItems.length > 0
        ? staticItems.reduce((a, b) => a + b.engagementScore, 0) / staticItems.length
        : 0;
    const bestFormat =
      videoAvg >= staticAvg && videoItems.length > 0 ? "VERTICAL_VIDEO" : "EDITORIAL_POSTER";

    // Kısa (<90 kelime) vs Uzun (>=90 kelime) metin karşılaştırması
    const conciseItems = effectiveList.filter((i) => i.wordCount <= 90);
    const longItems = effectiveList.filter((i) => i.wordCount > 90);
    const conciseAvg =
      conciseItems.length > 0
        ? conciseItems.reduce((a, b) => a + b.engagementScore, 0) / conciseItems.length
        : 0;
    const longAvg =
      longItems.length > 0
        ? longItems.reduce((a, b) => a + b.engagementScore, 0) / longItems.length
        : 0;

    // En yüksek ve en düşük performanslı gönderiler
    const sortedByScore = [...effectiveList].sort(
      (a, b) => b.engagementScore - a.engagementScore
    );
    const topPosts = sortedByScore.slice(0, 3).map((p) => ({
      platform: p.platform,
      hasVideo: p.hasVideo,
      wordCount: p.wordCount,
      engagementScore: p.engagementScore,
      impressions: p.impressions,
      excerpt: p.adaptedText.slice(0, 180),
    }));
    const bottomPosts = sortedByScore
      .slice(-2)
      .reverse()
      .map((p) => ({
        platform: p.platform,
        hasVideo: p.hasVideo,
        wordCount: p.wordCount,
        engagementScore: p.engagementScore,
        impressions: p.impressions,
        excerpt: p.adaptedText.slice(0, 180),
      }));

    // Merkezi AI Hub (LEARNING_ENGINE) ile gerçek veriden içgörü ve ajan tavsiyesi sentezle
    let updatedWisdom: BrandWisdom | null = null;
    try {
      const aiRes = await ToprakAiHub.dispatch({
        agentRole: "LEARNING_ENGINE",
        jsonMode: true,
        systemInstruction: `Sen Toprak Otonom İçerik Motorunun Veri Bilimcisi ve Öğrenme Motorusun (Learning Engine).
Görevin, YALNIZCA sana verilen gerçek yayın istatistiklerini inceleyerek ajanlara (Trend, Copywriter, PromptArchitect, Validator) somut, dürüst ve uygulanabilir tavsiyeler üretmektir. Veride olmayan sahte yüzdeler uydurma.`,
        prompt: `Marka: ${data.brandName} (${brandSlug})
Analiz Edilen Yayınlanmış Gönderi Sayısı: ${scored.length}
Ortalama Ağırlıklı Etkileşim Skoru: %${avgEngagement.toFixed(2)}
En İyi Platform: ${bestPlatform}
En İyi Format: ${bestFormat} (Video Ort: ${videoAvg.toFixed(2)}, Görsel Ort: ${staticAvg.toFixed(2)})
Metin Uzunluğu Özeti: <=90 kelime ort: ${conciseAvg.toFixed(2)} (${conciseItems.length} adet) | >90 kelime ort: ${longAvg.toFixed(2)} (${longItems.length} adet)
Platform Kırılımı: ${JSON.stringify(platformBreakdown)}

En Başarılı Gönderi Örnekleri:
${JSON.stringify(topPosts, null, 2)}

En Düşük Etkileşimli Gönderi Örnekleri:
${JSON.stringify(bottomPosts, null, 2)}

Lütfen aşağıdaki JSON yapısında yanıt ver:
{
  "provenWinners": [
    {
      "category": "HOOK | FORMAT | PACING | CASTING | COPY_LENGTH | PLATFORM",
      "pattern": "Veride gözlemlenen başarılı örüntü",
      "impactScore": "Gerçek gözlem (örn: Ort. %${avgEngagement.toFixed(1)} etkileşim)",
      "confidence": 0.75,
      "status": "PROVEN_WINNER",
      "actionableDirective": "Ajanların uygulayacağı net kural"
    }
  ],
  "underperformingWarnings": [
    {
      "category": "COPY_LENGTH | HOOK | FORMAT | PLATFORM",
      "pattern": "Düşük performans gösteren örüntü",
      "impactScore": "Gözlemlenen düşüş veya risk",
      "confidence": 0.7,
      "status": "UNDERPERFORMING",
      "actionableDirective": "Kaçınılması gereken davranış"
    }
  ],
  "councilDirectives": {
    "trendAgentGuidance": "Trend ajanına konu seçimi için veri odaklı tavsiye",
    "copywriterGuidance": "Yazar ajanına kanca, ton ve kelime uzunluğu tavsiyesi",
    "promptArchitectGuidance": "Görsel/video yönetmenine format ve sahne tavsiyesi",
    "validatorGuidance": "Denetçi ajana kalite kontrol tavsiyesi"
  }
}`,
      });

      const parsed = JSON.parse(aiRes.text) as Partial<BrandWisdom>;
      if (parsed.councilDirectives) {
        updatedWisdom = {
          brandSlug,
          brandName: data.brandName || brandSlug.toUpperCase(),
          lastAnalyzedAt: new Date().toISOString(),
          totalPostsAnalyzed: scored.length,
          overallEngagementRate: Number(avgEngagement.toFixed(2)),
          bestPlatform,
          bestFormat,
          provenWinners: Array.isArray(parsed.provenWinners) ? parsed.provenWinners : [],
          underperformingWarnings: Array.isArray(parsed.underperformingWarnings)
            ? parsed.underperformingWarnings
            : [],
          councilDirectives: parsed.councilDirectives,
        };
      }
    } catch (err) {
      console.warn(
        `[Toprak LearningEngine] LLM sentezi başarısız oldu, deterministik istatistik özeti kullanılıyor:`,
        err
      );
    }

    if (!updatedWisdom) {
      updatedWisdom = {
        brandSlug,
        brandName: data.brandName || brandSlug.toUpperCase(),
        lastAnalyzedAt: new Date().toISOString(),
        totalPostsAnalyzed: scored.length,
        overallEngagementRate: Number(avgEngagement.toFixed(2)),
        bestPlatform,
        bestFormat,
        provenWinners: [
          {
            category: "PLATFORM",
            pattern: `${bestPlatform.toUpperCase()} platformunda en yüksek etkileşim yakalandı`,
            impactScore: `Ort. %${Math.max(0, bestPlatformAvg).toFixed(2)} skor`,
            confidence: Math.min(0.9, 0.5 + scored.length * 0.04),
            status: "PROVEN_WINNER",
            actionableDirective: `${bestPlatform.toUpperCase()} diline uygun hızlı ve net içerik yapısını koru.`,
          },
        ],
        underperformingWarnings: [
          {
            category: "COPY_LENGTH",
            pattern:
              longAvg < conciseAvg
                ? "90 kelime üstü uzun metinlerde etkileşim daha düşük kaldı"
                : "Çok kısa ve bağlamsız metinlerde etkileşim sınırlı kaldı",
            impactScore: `Uzun: %${longAvg.toFixed(2)} vs Kısa: %${conciseAvg.toFixed(2)}`,
            confidence: 0.65,
            status: "UNDERPERFORMING",
            actionableDirective:
              longAvg < conciseAvg
                ? "Açıklamaları 60-90 kelime bandında öz ve vurucu tut."
                : "Okuyucuya somut fayda sunan 2-3 net madde ekle.",
          },
        ],
        councilDirectives: {
          trendAgentGuidance: `${scored.length} yayın verisine göre en güçlü kanal ${bestPlatform.toUpperCase()}. Hedef kitlenin doğrudan günlük problemine dokunan konuları seç.`,
          copywriterGuidance:
            longAvg <= conciseAvg
              ? "İlk cümlede güçlü merak kancası kur ve metni 90 kelimenin altında tut."
              : "İlk cümlede net kanca kur ve somut örneklerle destekle.",
          promptArchitectGuidance:
            bestFormat === "VERTICAL_VIDEO"
              ? "Dikey 9:16 hareketli sahneleri ve doğal ışıklandırmayı önceliklendir."
              : "Yüksek kontrastlı editoryal poster kompozisyonlarını önceliklendir.",
          validatorGuidance:
            "Platform karakter sınırlarını ve klişe AI ifadelerini sıkı denetle.",
        },
      };
    }

    this.persistWisdom(brandSlug, updatedWisdom!);
    console.log(
      `[Toprak LearningEngine] 💡 Öğrenme Tamamlandı (${scored.length} gerçek gönderi analiz edildi): ${brandSlug}`
    );
    return updatedWisdom!;
  }

  private static scoreRealDeliveries(data: ToprakBridgeAnalyticsData): ScoredPostItem[] {
    // Platform bazlı ortalama snapshot (teslimat bazlı eşleşme yoksa gerçek hesap ortalamasını kullanmak için)
    const platformSnapMap = new Map<
      string,
      { impressions: number; likes: number; comments: number; shares: number; clicks: number; count: number }
    >();

    for (const s of data.snapshots) {
      if (!s.postDeliveryId) {
        const cur = platformSnapMap.get(s.platform) || {
          impressions: 0,
          likes: 0,
          comments: 0,
          shares: 0,
          clicks: 0,
          count: 0,
        };
        cur.impressions += s.impressions;
        cur.likes += s.likes;
        cur.comments += s.comments;
        cur.shares += s.shares;
        cur.clicks += s.clicks;
        cur.count += 1;
        platformSnapMap.set(s.platform, cur);
      }
    }

    return data.publishedDeliveries
      .filter((d: any) => TOPRAK_PLATFORMS.includes(d.platform as ToprakPlatform))
      .map((d: any) => {
        const exactSnap = data.snapshots.find((s: any) => s.postDeliveryId === d.id);
        const fallbackPlatformAvg = platformSnapMap.get(d.platform);

        let impressions = 0;
        let likes = 0;
        let comments = 0;
        let shares = 0;
        let clicks = 0;
        let hasRealSnapshot = false;

        if (exactSnap) {
          impressions = exactSnap.impressions;
          likes = exactSnap.likes;
          comments = exactSnap.comments;
          shares = exactSnap.shares;
          clicks = exactSnap.clicks;
          hasRealSnapshot = true;
        } else if (fallbackPlatformAvg && fallbackPlatformAvg.count > 0) {
          impressions = Math.round(fallbackPlatformAvg.impressions / fallbackPlatformAvg.count);
          likes = Math.round(fallbackPlatformAvg.likes / fallbackPlatformAvg.count);
          comments = Math.round(fallbackPlatformAvg.comments / fallbackPlatformAvg.count);
          shares = Math.round(fallbackPlatformAvg.shares / fallbackPlatformAvg.count);
          clicks = Math.round(fallbackPlatformAvg.clicks / fallbackPlatformAvg.count);
          hasRealSnapshot = true;
        }

        const weighted = likes * 1.0 + comments * 2.5 + shares * 4.0 + clicks * 1.5;
        const engagementScore =
          impressions > 0
            ? Number(((weighted / Math.max(impressions, 50)) * 100).toFixed(2))
            : 0;

        const words = d.adaptedText.trim().split(/\s+/).filter(Boolean);
        const firstSentence = d.adaptedText.slice(0, 120);

        return {
          id: d.id,
          platform: d.platform as ToprakPlatform,
          adaptedText: d.adaptedText,
          wordCount: words.length,
          hasQuestionHook: firstSentence.includes("?"),
          hasVideo: d.hasVideo,
          impressions,
          likes,
          comments,
          shares,
          clicks,
          engagementScore,
          hasRealSnapshot,
        };
      });
  }

  private static createColdStartWisdom(brandSlug: string, brandName: string): BrandWisdom {
    return {
      brandSlug,
      brandName,
      lastAnalyzedAt: new Date().toISOString(),
      totalPostsAnalyzed: 0,
      overallEngagementRate: 0,
      bestPlatform: "instagram",
      bestFormat: "VERTICAL_VIDEO",
      provenWinners: [],
      underperformingWarnings: [],
      councilDirectives: {
        trendAgentGuidance:
          "Henüz geçmiş paylaşım verisi toplanmadı (Cold-Start). Hedef kitlenin en somut günlük sorunlarına ve merak uyandıran zıtlık açılarına odaklan.",
        copywriterGuidance:
          "Girişte selamlama kullanmadan ilk 3 saniyede doğrudan kancaya gir. Platform karakter limitlerine tam uy ve metni akıcı tut.",
        promptArchitectGuidance:
          "Markanın kendi sektörüne ve renk paletine sadık, doğal ışıklandırmalı ve gerçekçi dokulu görsel/video sahneler tasarla.",
        validatorGuidance:
          "Marka yasaklı kelimelerini, yapay zeka klişelerini ve platform karakter sınırlarını titizlikle denetle.",
      },
    };
  }

  private static persistWisdom(brandSlug: string, wisdom: BrandWisdom): void {
    const filePath = this.getWisdomFilePath(brandSlug);
    fs.writeFileSync(filePath, JSON.stringify(wisdom, null, 2), "utf-8");

    const globalPath = path.join(this.getMemoryDir(), "global_insights.json");
    try {
      let memoryStore: Record<string, unknown> = {};
      if (fs.existsSync(globalPath)) {
        memoryStore = JSON.parse(fs.readFileSync(globalPath, "utf-8"));
      }
      memoryStore[wisdom.brandSlug] = {
        lastAnalyzedAt: wisdom.lastAnalyzedAt,
        totalPostsAnalyzed: wisdom.totalPostsAnalyzed,
        overallEngagementRate: wisdom.overallEngagementRate,
        bestPlatform: wisdom.bestPlatform,
        bestFormat: wisdom.bestFormat,
      };
      fs.writeFileSync(globalPath, JSON.stringify(memoryStore, null, 2), "utf-8");
    } catch {
      // global özet güncellenemezse yoksay
    }
  }
}
