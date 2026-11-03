import fs from "node:fs";
import path from "node:path";
import { BrandDiscovery, QualifiedBrand } from "./brand-discovery";
import { BrandKnowledge, BrandKnowledgeSchema } from "./types";
import { getBrandTemplateConfig, loadToprakConfig } from "./config";
import { ToprakAiHub } from "./ai-hub";
import { BrandAssetResolver } from "./brand-asset-resolver";

export class BrandKnowledgeStore {
  private static getBrandsDir(): string {
    const dir = path.join(loadToprakConfig().storageDir, "brands");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private static getFilePath(slug: string): string {
    return path.join(this.getBrandsDir(), `${slug}.json`);
  }

  /**
   * Yerel hafızadaki marka profilini okur.
   */
  static getBrand(slug: string): BrandKnowledge | null {
    const filePath = this.getFilePath(slug);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return BrandKnowledgeSchema.parse(data);
    } catch (err) {
      console.warn(`[BrandKnowledgeStore] ${slug} verisi okunamadı:`, err);
      return null;
    }
  }

  /**
   * Hafızadaki tüm senkronize markaları listeler.
   */
  static getAllSyncedBrands(): BrandKnowledge[] {
    const dir = this.getBrandsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const list: BrandKnowledge[] = [];

    for (const file of files) {
      try {
        const fullPath = path.join(dir, file);
        const data = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        list.push(BrandKnowledgeSchema.parse(data));
      } catch {
        // Bozuk dosyayı atla
      }
    }
    return list;
  }

  /**
   * Üretim öncesi Social Hub'dan markanın canlı HEALTHY platformlarını doğrular ve
   * güncel BrandKnowledge profilini hazırlar.
   */
  static async resolveBrandForProduction(brandSlug: string): Promise<{
    socialBrand: QualifiedBrand;
    knowledge: BrandKnowledge;
  }> {
    const socialBrand = await BrandDiscovery.getBrandBySlug(brandSlug);
    if (!socialBrand) {
      throw new Error(
        `Lappsoft Social üzerinde "${brandSlug}" adında aktif bir marka bulunamadı.`
      );
    }

    if (socialBrand.healthyPlatforms.length === 0) {
      throw new Error(
        `"${socialBrand.name}" markasının Lappsoft Social üzerinde bağlı ve sağlıklı (HEALTHY) hiçbir sosyal medya hesabı yok. Önce Social üzerinden hesap bağlayın.`
      );
    }

    const knowledge = await this.syncBrand(socialBrand, { force: false });
    return { socialBrand, knowledge };
  }

  /**
   * Markanın Social BrandKit bilgilerini, varsa gerçek web sayfasını ve şablon ipuçlarını birleştirip
   * Merkezi AI Hub (BRAND_ANALYST) ile Marka DNA'sını çıkarır.
   */
  static async syncBrand(
    brand: QualifiedBrand,
    options: { force?: boolean } = {}
  ): Promise<BrandKnowledge> {
    const filePath = this.getFilePath(brand.slug);
    const templateHint = getBrandTemplateConfig(brand.slug);
    const visualIdentity = BrandAssetResolver.resolveIdentity(brand);
    const isGenericPrimary =
      !brand.primaryColor || ["#3b82f6", "#2563eb"].includes(brand.primaryColor.toLowerCase()) && brand.slug !== "career-ai";
    const isGenericAccent =
      !brand.accentColor || ["#60a5fa", "#ec4899"].includes(brand.accentColor.toLowerCase());
    const resolvedPrimaryColor = isGenericPrimary
      ? visualIdentity.primaryColor
      : brand.primaryColor!;
    const resolvedAccentColor = isGenericAccent
      ? visualIdentity.accentColor
      : brand.accentColor!;

    if (!options.force && fs.existsSync(filePath)) {
      const existing = this.getBrand(brand.slug);
      if (existing) {
        // Canlı Social verilerini (sağlıklı platformlar, renkler, yasaklı kelimeler) her zaman taze tut
        existing.healthyPlatforms = brand.healthyPlatforms;
        existing.primaryColor = resolvedPrimaryColor || existing.primaryColor;
        existing.accentColor = resolvedAccentColor || existing.accentColor;
        existing.defaultLanguage = brand.defaultLanguage || existing.defaultLanguage;
        if (brand.websiteUrl) existing.websiteUrl = brand.websiteUrl;
        if (templateHint?.sector) {
          existing.sector = templateHint.sector;
        }
        if (
          brand.toneOfVoice &&
          (!existing.toneOfVoice || brand.toneOfVoice.length >= existing.toneOfVoice.length)
        ) {
          existing.toneOfVoice = brand.toneOfVoice;
        }
        if (templateHint?.targetAudience) {
          existing.targetAudience = templateHint.targetAudience;
        } else if (
          brand.targetAudience &&
          (!existing.targetAudience || brand.targetAudience.length >= existing.targetAudience.length)
        ) {
          existing.targetAudience = brand.targetAudience;
        }

        existing.bannedWords = Array.from(
          new Set([
            ...(existing.bannedWords || []),
            ...(brand.bannedWords || []),
            ...(templateHint?.bannedWords || []),
          ])
        );
        existing.hashtags = Array.from(
          new Set([
            ...(existing.hashtags || []),
            ...(templateHint?.hashtags || []),
            ...(brand.defaultHashtags || []),
          ])
        );

        const validatedExisting = BrandKnowledgeSchema.parse(existing);
        fs.writeFileSync(filePath, JSON.stringify(validatedExisting, null, 2), "utf-8");
        return validatedExisting;
      }
    }

    let cleanText = "";
    const trimmedUrl = brand.websiteUrl?.trim() || "";
    if (/^https?:\/\//i.test(trimmedUrl)) {
      console.log(`[BrandKnowledgeStore] 🌐 Web sayfası taranıyor: ${brand.name} (${trimmedUrl})...`);
      try {
        const res = await fetch(trimmedUrl, {
          headers: {
            "User-Agent": "ToprakBrandCrawler/2.0 (+https://lappsoft.com)",
          },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const rawHtml = await res.text();
          cleanText = rawHtml
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 6000);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BrandKnowledgeStore] ${trimmedUrl} okunamadı (BrandKit verileriyle devam ediliyor): ${msg}`);
      }
    }

    console.log(`[BrandKnowledgeStore] 🧠 AI Hub (BRAND_ANALYST) Marka DNA çıkarıyor: ${brand.name}...`);

    const systemInstruction = `Sen kıdemli bir Kurumsal Marka Stratejisti ve Pazar İstihbarat Uzmanısın.
Görevin, verilen marka bilgilerini ve varsa web sayfası metnini inceleyerek markanın DNA'sını, ürün özelliklerini, rakiplerini ve hedef kitlesini yapılandırmaktır.`;

    const prompt = `Marka Adı: ${brand.name}
Marka Slug: ${brand.slug}
Web Adresi: ${trimmedUrl || "(Belirtilmemiş)"}
Sağlıklı Sosyal Medya Platformları: ${brand.healthyPlatforms.join(", ") || "(Henüz bağlı değil)"}
Social BrandKit Ses Tonu: ${brand.toneOfVoice || templateHint?.toneOfVoice || "(Belirtilmemiş)"}
Social BrandKit Hedef Kitle: ${brand.targetAudience || templateHint?.targetAudience || "(Belirtilmemiş)"}
Bilinen Sektör İpucu: ${templateHint?.sector || "(Marka adından ve bağlamdan çıkar)"}
Bilinen İçerik Açıları: ${templateHint?.contentAngles?.join(" | ") || "(Belirtilmemiş)"}

Web Sayfasından Çekilen Metin:
"""
${cleanText || "Web sayfası metni mevcut değil; Social BrandKit ve marka bağlamını esas al."}
"""

Lütfen YALNIZCA aşağıdaki JSON şemasına uygun geçerli bir JSON döndür:
{
  "sector": "Markanın faaliyet gösterdiği net sektör",
  "tagline": "Markanın en vurucu sloganı",
  "mission": "Markanın çözmeye çalıştığı ana misyon",
  "valueProposition": "Kullanıcının rakipler yerine bu markayı seçme sebebi",
  "targetAudience": "Yaş, meslek ve ilgi alanları bazında hedef kitle",
  "toneOfVoice": "Sosyal medyada kullanacağı konuşma dili ve karakteri",
  "coreProducts": ["1. Ana Ürün/Özellik", "2. Ana Ürün/Özellik"],
  "mainCompetitors": ["En az 3 doğrudan veya dolaylı rakip"],
  "consumerPainPoints": ["Hedef kitlenin yaşadığı en az 3 somut sorun"],
  "contentPillars": ["Sosyal medyada işlenecek 3-4 ana içerik sütunu"],
  "hashtags": ["#${brand.slug}"],
  "bannedWords": ["ucuz", "şok fiyat"]
}`;

    let parsedAi: Partial<BrandKnowledge> = {};
    try {
      const aiRes = await ToprakAiHub.dispatch({
        agentRole: "BRAND_ANALYST",
        systemInstruction,
        prompt,
        jsonMode: true,
      });
      parsedAi = JSON.parse(aiRes.text) as Partial<BrandKnowledge>;
    } catch (err) {
      console.warn(`[BrandKnowledgeStore] AI analizi yedek şablona düştü:`, err);
    }

    const mergedHashtags = Array.from(
      new Set([
        ...(brand.defaultHashtags || []),
        ...(templateHint?.hashtags || []),
        ...(Array.isArray(parsedAi.hashtags) ? parsedAi.hashtags : []),
      ])
    ).filter(Boolean);

    const mergedBannedWords = Array.from(
      new Set([
        ...(brand.bannedWords || []),
        ...(templateHint?.bannedWords || []),
        ...(Array.isArray(parsedAi.bannedWords) ? parsedAi.bannedWords : []),
      ])
    ).filter(Boolean);

    const brandKnowledge: BrandKnowledge = {
      id: brand.id,
      slug: brand.slug,
      name: brand.name,
      websiteUrl: trimmedUrl,
      primaryColor: resolvedPrimaryColor || templateHint?.primaryColor || "#3b82f6",
      accentColor: resolvedAccentColor || templateHint?.accentColor || "#60a5fa",
      defaultLanguage: brand.defaultLanguage || templateHint?.defaultLanguage || "tr",
      healthyPlatforms: brand.healthyPlatforms,
      sector: parsedAi.sector || templateHint?.sector || "Teknoloji & Dijital Ürün",
      tagline: parsedAi.tagline || brand.name,
      mission: parsedAi.mission || `${brand.name} kullanıcılarına yüksek katma değerli dijital deneyim sunar.`,
      valueProposition:
        parsedAi.valueProposition ||
        `${brand.name} ile hızlı, modern ve güvenilir çözüm.`,
      targetAudience:
        brand.targetAudience ||
        parsedAi.targetAudience ||
        templateHint?.targetAudience ||
        "Dijital odaklı modern kullanıcılar",
      toneOfVoice:
        brand.toneOfVoice ||
        parsedAi.toneOfVoice ||
        templateHint?.toneOfVoice ||
        "Profesyonel, net ve samimi",
      coreProducts: Array.isArray(parsedAi.coreProducts) ? parsedAi.coreProducts : [],
      mainCompetitors: Array.isArray(parsedAi.mainCompetitors) ? parsedAi.mainCompetitors : [],
      consumerPainPoints: Array.isArray(parsedAi.consumerPainPoints)
        ? parsedAi.consumerPainPoints
        : [],
      contentPillars:
        Array.isArray(parsedAi.contentPillars) && parsedAi.contentPillars.length > 0
          ? parsedAi.contentPillars
          : templateHint?.contentAngles || [],
      hashtags: mergedHashtags.length > 0 ? mergedHashtags : [`#${brand.slug}`],
      bannedWords: mergedBannedWords,
      lastSyncedAt: new Date().toISOString(),
    };

    const validated = BrandKnowledgeSchema.parse(brandKnowledge);
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), "utf-8");
    console.log(`[BrandKnowledgeStore] 💾 Marka DNA kaydedildi: ${filePath}`);

    return validated;
  }
}
