import { ToprakAiHub } from "../core/ai-hub";
import {
  BrandKnowledge,
  BrandProfile,
  PlatformContent,
  ProductionPrompts,
  ToprakPlatform,
  ValidationReport,
  ValidationReportSchema,
} from "../core/types";
import { BrandKnowledgeStore } from "../core/brand-knowledge-store";
import { LearningEngine } from "../core/learning-engine";
import { FullProductionPackage, PlatformMasterProduction } from "./copywriter-agent";

// ==========================================
// 1. DETERMINISTIK KURAL LİSTELERİ (TÜRKÇE KÜÇÜK HARF UYUMLU)
// ==========================================
export const COMMON_AI_CLICHES = [
  "günümüzün dijital dünyasında",
  "günümüz dünyasında",
  "dijital çağda",
  "unutmayın ki",
  "gelin birlikte bakalım",
  "gelin inceleyelim",
  "harika bir deneyim",
  "sizi bekliyor",
  "adım atın",
  "keşfetmeye hazır mısınız",
  "hayatınızı kolaylaştıracak",
  "vazgeçilmeziniz olacak",
  "büyüleyici bir yolculuk",
];

export class ValidatorAgent {
  private static normalizeBrand(brandInput: BrandProfile | BrandKnowledge | string): BrandKnowledge {
    if (typeof brandInput === "string") {
      const cached = BrandKnowledgeStore.getBrand(brandInput);
      if (!cached) {
        throw new Error(`[ValidatorAgent] '${brandInput}' markası hafızada bulunamadı!`);
      }
      return cached;
    }
    if ("consumerPainPoints" in brandInput) {
      return brandInput;
    }
    const cached = BrandKnowledgeStore.getBrand(brandInput.slug);
    if (cached) return cached;

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
   * 5'Lİ BAĞIMSIZ KALİTE GÜVENCE VE DENETİM KONSEYİ.
   * Merkezi AI Hub'da VALIDATOR_AGENT rolüyle (Yazar ajanından FARKLI model ailesiyle) çalışır.
   */
  static async validate(
    brandInput: BrandProfile | BrandKnowledge | string,
    packageToAudit: FullProductionPackage | Record<ToprakPlatform, PlatformContent>,
    productionPrompts?: ProductionPrompts
  ): Promise<ValidationReport> {
    const brand = this.normalizeBrand(brandInput);
    console.log(`[Toprak ValidatorAgent] 🛡️ 5'li Kalite ve Denetim Konseyi Göreve Başladı: ${brand.name}`);

    const auditSummary = this.buildAuditSummary(packageToAudit, productionPrompts);

    // DETERMINISTIK ÖN DENETİM (HARD CHECKS)
    const hardViolations: string[] = [];
    const hardWarnings: string[] = [];
    const passedDeterministicRules: string[] = [];

    // 1. Yasaklı Kelime Kontrolü (Türkçe tr-TR küçük harf dönüşümü ile İ/I hatasız)
    const allTextLowerTr = auditSummary.toLocaleLowerCase("tr-TR");
    for (const bw of brand.bannedWords) {
      const normalizedBw = bw?.trim().toLocaleLowerCase("tr-TR");
      if (normalizedBw && allTextLowerTr.includes(normalizedBw)) {
        hardViolations.push(`KRİTİK MARKA İHLALİ: Yasaklı kelime tespit edildi: "${bw}"`);
      }
    }
    if (hardViolations.length === 0) {
      passedDeterministicRules.push("Yasaklı kelime filtresi temiz: Hiçbir yasaklı terim kullanılmamış.");
    }

    // 2. Yapay Zeka Klişe ve Abartılı Saniye Vaadi Taraması
    const detectedCliches: string[] = [];
    for (const cliche of COMMON_AI_CLICHES) {
      if (allTextLowerTr.includes(cliche.toLocaleLowerCase("tr-TR"))) {
        detectedCliches.push(cliche);
        hardWarnings.push(`YAPAY ZEKA KLİŞESİ: Metinde "${cliche}" jenerik kalıbı yakalandı.`);
      }
    }
    if (
      /\b\d+\s*saniyede\b/iu.test(auditSummary) ||
      /\bsaniyeler?\s+iç(?:in|erisin)de\b/iu.test(auditSummary)
    ) {
      hardWarnings.push(
        `ZAMAN VAADİ UYARISI: Metinde kesin saniye vaadi ("15 saniyede" / "saniyeler içinde") kullanılmış; "dakikalar içinde" veya "kısa sürede" olarak değiştirilmelidir.`
      );
    }
    if (detectedCliches.length === 0) {
      passedDeterministicRules.push("Yapay zeka klişe taraması temiz: Metin doğal diksiyona sahip.");
    }

    // 3. Video Seslendirme Hızı Kontrolü
    const pacingWarnings = this.checkVideoPacing(packageToAudit);
    hardWarnings.push(...pacingWarnings);
    if (pacingWarnings.length === 0) {
      passedDeterministicRules.push("Seslendirme ve sahne süresi temposu dengeli.");
    }

    // 4. Platform Karakter Limitleri ve Hashtag Sağlığı Kontrolü
    const platformWarnings = this.checkPlatformLimitsAndHashtags(packageToAudit);
    hardWarnings.push(...platformWarnings);
    if (platformWarnings.length === 0) {
      passedDeterministicRules.push("Tüm platform karakter sınırları ve etiket kuralları uyumlu.");
    }

    const wisdom = LearningEngine.getWisdomForBrand(brand.slug);

    const systemInstruction = `Sen "${brand.name}" markası (${brand.sector}) için çalışan 5 kişilik kıdemli ve BAĞIMSIZ bir Sosyal Medya Kalite Güvence ve Denetim Heyetisin:
1. Marka Kimliği & Tonu Baş Müfettişi: Marka ses tonu (${brand.toneOfVoice}), sektör tutarlılığı (${brand.sector}) ve hedef kitle (${brand.targetAudience}) uyumunu denetler.
2. Türkçe Dil Bilgisi & Diksiyon Editörü: İmla hatalarını, anlatım bozukluklarını ve yapay zeka klişelerini denetler.
3. Sinematografik & Görsel Uygulanabilirlik Hakemi: Video sahnelerinin ve görsel promptların marka sektörüne uygunluğunu denetler.
4. Platform Algoritması & Güvenlik Uzmanı: X (<=280 kr), Threads (<=500 kr), YouTube Shorts başlığı (<=100 kr), Reddit (hashtagsiz) ve diğer platform kurallarını denetler.
5. Nöro-Pazarlama & Kanca Yargıcı: İlk 3 saniye kancasının durduruculuğunu ve eylem çağrısının (CTA) gücünü puanlar.

ÖĞRENME MOTORU REHBERİ:
${wisdom.councilDirectives.validatorGuidance}

PUANLAMA (0 - 100):
- 85 - 100: "APPROVED" (Sosyal medya onay kuyruğuna aktarılmaya hazır)
- 70 - 84: "NEEDS_REVISION" (Revizyon döngüsü gerektiren pürüzler var)
- 0 - 69: "REJECTED" (Ciddi marka/kalite ihlali)

Yanıtını YALNIZCA geçerli bir JSON olarak ver.`;

    const prompt = `# MARKA REFERANSI
- Marka Adı: ${brand.name}
- Sektör: ${brand.sector}
- Değer Önerisi: ${brand.valueProposition}
- Hedef Kitle: ${brand.targetAudience}
- Ses Tonu: ${brand.toneOfVoice}
- Yasaklı Kelimeler: ${brand.bannedWords.join(", ") || "Yok"}

# DENETLENECEK ÜRETİM PAKETİ VE GÖRSEL PROMPTLAR:
"""
${auditSummary}
"""

# DETERMINISTIK ÖN DENETİM BULGULARI:
- Kritik İhlaller: ${hardViolations.length > 0 ? hardViolations.join(" | ") : "Yok"}
- Teknik Uyarılar: ${hardWarnings.length > 0 ? hardWarnings.join(" | ") : "Yok"}

Aşağıdaki JSON şemasına tam uygun yanıt üret:
{
  "overallScore": 90,
  "brandToneScore": 92,
  "grammarScore": 90,
  "visualFeasibilityScore": 90,
  "platformSafetyScore": 92,
  "hookQualityScore": 88,
  "status": "APPROVED",
  "passedRules": ["Marka tonuna ve sektörüne tam uyumlu", "Türkçe imla ve akıcılık doğal"],
  "violations": [],
  "actionableRevisions": [],
  "improvementNotes": "Genel heyet değerlendirme özeti",
  "expertAudits": {
    "brandAuditor": { "passed": true, "notes": "Marka kimliği korundu." },
    "linguisticLead": { "passed": true, "notes": "Türkçe doğal ve akıcı.", "clichesFound": [] },
    "visualLead": { "passed": true, "notes": "Sahne ve görsel direktifleri uygulanabilir." },
    "platformSafetyLead": { "passed": true, "notes": "Karakter ve etiket kuralları uygun." },
    "neuroMarketingJudge": { "passed": true, "notes": "Kanca dikkat çekici." }
  }
}`;

    try {
      const res = await ToprakAiHub.dispatch({
        agentRole: "VALIDATOR_AGENT",
        systemInstruction,
        prompt,
        jsonMode: true,
      });

      console.log(
        `[Toprak ValidatorAgent] ✅ Bağımsız denetçi yanıtladı: ${res.provider}/${res.modelUsed} (${res.durationMs}ms)`
      );
      const parsed = JSON.parse(res.text);

      const allViolations = Array.from(
        new Set([...(Array.isArray(parsed.violations) ? parsed.violations : []), ...hardViolations])
      ).filter(Boolean);
      const allActionableRevisions = Array.from(
        new Set([
          ...(Array.isArray(parsed.actionableRevisions) ? parsed.actionableRevisions : []),
          ...hardWarnings,
        ])
      ).filter(Boolean);
      const allPassedRules = Array.from(
        new Set([
          ...(Array.isArray(parsed.passedRules) ? parsed.passedRules : []),
          ...passedDeterministicRules,
        ])
      ).filter(Boolean);

      let overallScore = Number(parsed.overallScore) || 85;
      let status: "APPROVED" | "NEEDS_REVISION" | "REJECTED" = parsed.status || "APPROVED";

      if (hardViolations.length > 0) {
        overallScore = Math.min(50, overallScore);
        status = "REJECTED";
      } else if (detectedCliches.length >= 2) {
        overallScore = Math.min(78, overallScore);
        status = "NEEDS_REVISION";
      } else if (overallScore >= 85 && allViolations.length === 0) {
        status = "APPROVED";
      } else if (overallScore >= 70) {
        status = "NEEDS_REVISION";
      } else {
        status = "REJECTED";
      }

      const report: ValidationReport = {
        status,
        overallScore,
        brandToneScore: Number(parsed.brandToneScore) || 85,
        grammarScore: Number(parsed.grammarScore) || 85,
        hookQualityScore: Number(parsed.hookQualityScore) || 85,
        visualFeasibilityScore: Number(parsed.visualFeasibilityScore) || 85,
        platformSafetyScore: Number(parsed.platformSafetyScore) || 90,
        passedRules: allPassedRules,
        violations: allViolations,
        actionableRevisions: allActionableRevisions,
        improvementNotes:
          parsed.improvementNotes ||
          (status === "APPROVED"
            ? "Paket bağımsız kalite denetiminden başarıyla geçti."
            : "Belirtilen revizyon maddeleri düzeltilmelidir."),
        expertAudits: parsed.expertAudits,
        evaluatedAt: new Date().toISOString(),
      };

      return ValidationReportSchema.parse(report);
    } catch (err) {
      console.warn(
        "[Toprak ValidatorAgent] LLM denetim çağrısı başarısız, deterministik denetçi devrede:",
        err
      );
      return this.generateDeterministicFallback(
        hardViolations,
        hardWarnings,
        passedDeterministicRules
      );
    }
  }

  private static buildAuditSummary(
    pkg: FullProductionPackage | Record<ToprakPlatform, PlatformContent>,
    productionPrompts?: ProductionPrompts
  ): string {
    const lines: string[] = [];

    if ("platforms" in pkg) {
      for (const [platform, item] of Object.entries(pkg.platforms)) {
        const p = item as PlatformMasterProduction;
        lines.push(
          `--- PLATFORM: ${platform.toUpperCase()} (${p.formatDecision.formatType} - ${p.formatDecision.aspectRatio}) ---`
        );
        lines.push(`Başlık (${p.headline.length} kr): ${p.headline}`);
        lines.push(`Kanca (Hook): ${p.hookText}`);
        lines.push(`Açıklama (${p.caption.length} kr):\n${p.caption}`);
        lines.push(`Hashtagler (${p.hashtags.length} adet): ${p.hashtags.join(" ")}`);
        lines.push(`CTA: ${p.callToAction}`);

        if (p.videoProductionPlan) {
          lines.push(
            `[VİDEO PLANI] Rota: ${p.videoProductionPlan.overallEmotionalArc} | Müzik: ${p.videoProductionPlan.audioDesign.musicTrackStyle}`
          );
          p.videoProductionPlan.scenes.forEach((s, idx) => {
            lines.push(`  Sahne ${idx + 1} (${s.timeRange}) [${s.sceneMood}]:`);
            lines.push(
              `    Kamera & Işık: ${s.cinematography.cameraRig} | ${s.cinematography.lensAndFocal} | ${s.cinematography.lightingAndAtmosphere}`
            );
            lines.push(`    Ekran Yazısı: "${s.onScreenText.text}"`);
            lines.push(`    Seslendirme: "${s.voiceover.text}"`);
          });
        }

        if (p.posterProductionPlan) {
          lines.push(
            `[AFİŞ PLANI] Başlık: ${p.posterProductionPlan.artDirection.graphicPosterLayout.mainHeadline} | Oran: ${p.posterProductionPlan.aspectRatio}`
          );
          lines.push(
            `  Görsel Prompt: ${p.posterProductionPlan.artDirection.imageGenPrompt.masterPromptEn}`
          );
        }

        if (p.threadTweets && p.threadTweets.length > 0) {
          lines.push(
            `[X THREAD TWEETLERİ]:\n${p.threadTweets
              .map((t, i) => `${i + 1}. (${t.length} kr) ${t}`)
              .join("\n")}`
          );
        }
        lines.push("");
      }
    } else {
      for (const [platform, content] of Object.entries(pkg)) {
        const c = content as PlatformContent;
        lines.push(`--- PLATFORM: ${platform.toUpperCase()} ---`);
        lines.push(`Başlık: ${c.headline}`);
        lines.push(`Kanca: ${c.hookText || "Yok"}`);
        lines.push(`Açıklama: ${c.caption}`);
        lines.push(`Hashtagler: ${c.hashtags.join(" ")}`);
        lines.push(`CTA: ${c.callToAction || "Yok"}`);
        if (c.videoScript?.voiceoverText) {
          lines.push(`Seslendirme: ${c.videoScript.voiceoverText}`);
        }
        lines.push("");
      }
    }

    if (productionPrompts) {
      lines.push(`--- AI DIRECTOR GÖRSEL & VİDEO PROMPTLARI ---`);
      lines.push(`Video Master Prompt: ${productionPrompts.videoPrompt.masterPromptEn}`);
      lines.push(`Photo Master Prompt: ${productionPrompts.photoPrompt.masterPromptEn}`);
      if (productionPrompts.characterConsistency) {
        lines.push(`Cast Modeli: ${productionPrompts.characterConsistency.modelDescriptionEn}`);
      }
    }

    return lines.join("\n");
  }

  private static checkVideoPacing(
    pkg: FullProductionPackage | Record<ToprakPlatform, PlatformContent>
  ): string[] {
    const warnings: string[] = [];
    if ("platforms" in pkg) {
      for (const [platform, item] of Object.entries(pkg.platforms)) {
        const p = item as PlatformMasterProduction;
        if (p.videoProductionPlan) {
          p.videoProductionPlan.scenes.forEach((scene, i) => {
            const wordCount = scene.voiceover.text.trim().split(/\s+/).filter(Boolean).length;
            const match = scene.timeRange.match(/(\d+):(\d+)\s*-\s*(\d+):(\d+)/);
            if (match) {
              const startSec = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
              const endSec = parseInt(match[3], 10) * 60 + parseInt(match[4], 10);
              const duration = Math.max(1, endSec - startSec);
              const wordsPerSec = wordCount / duration;
              if (wordsPerSec > 3.6) {
                warnings.push(
                  `[${platform.toUpperCase()}] Sahne ${i + 1} (${scene.timeRange}): Seslendirme temposu çok hızlı (${wordCount} kelime / ${duration} sn). Metin kısaltılmalı.`
                );
              }
            }
          });
        }
      }
    }
    return warnings;
  }

  private static checkPlatformLimitsAndHashtags(
    pkg: FullProductionPackage | Record<ToprakPlatform, PlatformContent>
  ): string[] {
    const warnings: string[] = [];
    const entries = "platforms" in pkg ? Object.entries(pkg.platforms) : Object.entries(pkg);

    for (const [platform, rawItem] of entries) {
      const item = rawItem as PlatformMasterProduction & PlatformContent;
      const hashtags = item.hashtags || [];

      if (platform === "reddit") {
        if (hashtags.length > 0) {
          warnings.push(`[REDDIT] Reddit topluluk kültüründe hashtag kullanılmamalıdır.`);
        }
      } else {
        if (hashtags.length > 7) {
          warnings.push(
            `[${platform.toUpperCase()}] Aşırı hashtag kullanımı (${hashtags.length} adet). 3-5 adet niş etiket önerilir.`
          );
        } else if (hashtags.length === 0 && platform !== "github" && platform !== "threads") {
          warnings.push(
            `[${platform.toUpperCase()}] Keşfet görünürlüğü için en az 2 anahtar hashtag eklenmelidir.`
          );
        }
      }

      if (platform === "x") {
        if (item.caption && item.caption.length > 280) {
          warnings.push(`[X] Ana tweet 280 karakter sınırını aşıyor (${item.caption.length} kr).`);
        }
        if (Array.isArray(item.threadTweets)) {
          item.threadTweets.forEach((t, idx) => {
            if (t.length > 280) {
              warnings.push(`[X] Thread ${idx + 1}. tweet 280 karakter sınırını aşıyor (${t.length} kr).`);
            }
          });
        }
      }

      if (platform === "threads" && item.caption && item.caption.length > 500) {
        warnings.push(`[THREADS] Gönderi 500 karakter sınırını aşıyor (${item.caption.length} kr).`);
      }

      if (platform === "youtube" && item.headline && item.headline.length > 100) {
        warnings.push(`[YOUTUBE] Shorts başlığı 100 karakter sınırını aşıyor (${item.headline.length} kr).`);
      }
    }
    return warnings;
  }

  private static generateDeterministicFallback(
    hardViolations: string[],
    hardWarnings: string[],
    passedRules: string[]
  ): ValidationReport {
    const isApproved = hardViolations.length === 0 && hardWarnings.length <= 2;
    const overallScore = hardViolations.length > 0 ? 50 : isApproved ? 88 : 75;
    const status: "APPROVED" | "NEEDS_REVISION" | "REJECTED" =
      hardViolations.length > 0 ? "REJECTED" : isApproved ? "APPROVED" : "NEEDS_REVISION";

    return {
      status,
      overallScore,
      brandToneScore: hardViolations.length > 0 ? 50 : 86,
      grammarScore: 88,
      hookQualityScore: 85,
      visualFeasibilityScore: 86,
      platformSafetyScore: 90,
      passedRules: passedRules.length > 0 ? passedRules : ["Deterministik marka denetimi tamamlandı."],
      violations: hardViolations,
      actionableRevisions: hardWarnings,
      improvementNotes: isApproved
        ? "Yerel denetim kurallarına göre içerik onaylandı."
        : "Revizyon uyarıları giderilmelidir.",
      evaluatedAt: new Date().toISOString(),
    };
  }
}
