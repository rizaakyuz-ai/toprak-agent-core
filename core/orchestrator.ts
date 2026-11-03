import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { loadToprakConfig } from "./config";
import {
  BakedPackage,
  BrandKnowledge,
  MediaAsset,
  PlatformContent,
  ProductionPrompts,
  ToprakPlatform,
  ValidationReport,
} from "./types";
import { BrandDiscovery } from "./brand-discovery";
import { BrandKnowledgeStore } from "./brand-knowledge-store";
import { BrandAssetResolver } from "./brand-asset-resolver";
import { AudioExtractor } from "../pipelines/ingestion/audio-extractor";
import { Transcriber } from "../pipelines/ingestion/transcriber";
import { SubtitleGenerator } from "../pipelines/media/subtitles";
import { VideoAssembler } from "../pipelines/media/video-assembler";
import { ThumbnailGenerator } from "../pipelines/media/thumbnail-generator";
import { ImageGenerator } from "../pipelines/media/image-generator";
import {
  EmotionPreset,
  TtsEngine,
  TurkishPhoneticNormalizer,
} from "../pipelines/media/tts-engine";
import { TrendAgent, TrendIdeaDeep } from "../agents/trend-agent";
import { CopywriterAgent, FullProductionPackage } from "../agents/copywriter-agent";
import { ValidatorAgent } from "../agents/validator-agent";
import { PromptArchitect } from "../agents/prompt-architect";
import { PackageExporter } from "../pipelines/handoff/package-exporter";
import { SocialInjector } from "../pipelines/handoff/social-injector";
import { LearningEngine } from "./learning-engine";
import { ScenarioDefinition, ScenarioManager } from "./scenario-manager";

export interface BakeVideoOptions {
  videoPath: string;
  brandSlug: string;
  targetPlatforms?: ToprakPlatform[];
  autoInject?: boolean;
}

export interface BakeTopicOptions {
  brandSlug: string;
  customTopic?: string;
  targetPlatforms?: ToprakPlatform[];
  autoInject?: boolean;
}

export interface BatchBakeSummary {
  totalQualifiedBrands: number;
  succeeded: BakedPackage[];
  failed: Array<{ brandSlug: string; error: string }>;
}

export interface GeminiStudioDraft {
  batchId: string;
  brandSlug: string;
  brandName: string;
  topic: string;
  summaryText: string;
  scenarioTitle?: string;
  targetPlatforms: ToprakPlatform[];
  geminiProVideoPrompt: string;
  geminiProImagePrompt: string;
  voiceoverPreviewText: string;
  validationScore: number;
  validationStatus: string;
  deliveries: Record<ToprakPlatform, PlatformContent>;
  createdAt: string;
}

export interface FinalizeGeminiStudioOptions {
  batchId: string;
  uploadedVideoPath?: string;
  uploadedImagePath?: string;
  audioMode?: "TOPRAK_TTS_MIX" | "ORIGINAL_VIDEO_AUDIO";
  autoInject?: boolean;
}

interface StoredStudioDraftFile {
  batchId: string;
  createdAt: string;
  brand: BrandKnowledge;
  targetPlatforms: ToprakPlatform[];
  coverTitle: string;
  summaryText: string;
  scenarioTitle?: string;
  fullPkg: FullProductionPackage;
  deliveries: Record<ToprakPlatform, PlatformContent>;
  productionPrompts: ProductionPrompts;
  validation: ValidationReport;
  revisionCount: number;
  voicePlan: ExtractedVoicePlan;
}

interface ExtractedVoicePlan {
  displayVoiceText: string;
  phoneticText?: string;
  styleDirective?: string;
  emotionPreset?: EmotionPreset;
}

export class ToprakOrchestrator {
  /**
   * İstenen platform listesini markanın canlı HEALTHY platformlarıyla kesiştirir.
   * Hiçbir zaman sağlıksız (DISCONNECTED/EXPIRED) bir platform için üretim yapmaz.
   */
  private static resolveHealthyTargetPlatforms(
    healthyPlatforms: ToprakPlatform[],
    requested?: ToprakPlatform[]
  ): ToprakPlatform[] {
    if (!requested || requested.length === 0) {
      return [...healthyPlatforms];
    }
    const filtered = requested.filter((p) => healthyPlatforms.includes(p));
    if (filtered.length === 0) {
      throw new Error(
        `Seçilen platformlar (${requested.join(", ")}) bu markanın sağlıklı (HEALTHY) hesapları (${healthyPlatforms.join(", ")}) arasında yer almıyor.`
      );
    }
    return filtered;
  }

  private static pickPrimaryContent(
    deliveries: Record<ToprakPlatform, PlatformContent>,
    platforms: ToprakPlatform[]
  ): PlatformContent {
    const preferredOrder: ToprakPlatform[] = [
      "instagram",
      "tiktok",
      "youtube",
      "facebook",
      "x",
      ...platforms,
    ];
    for (const p of preferredOrder) {
      if (deliveries[p]) return deliveries[p];
    }
    return Object.values(deliveries)[0];
  }

  /**
   * En zengin video senaryosundan hem altyazıda görünecek yazılı metni ("Modena AI"),
   * hem de Türkçe fonetik okunuş + AI duygu/oyunculuk direktifini ayıklar.
   */
  private static extractBestVoiceoverPlan(
    deliveries: Record<ToprakPlatform, PlatformContent>,
    fallbackTitle: string
  ): ExtractedVoicePlan {
    const videoOrder: ToprakPlatform[] = ["instagram", "tiktok", "youtube"];
    for (const p of videoOrder) {
      const vs = deliveries[p]?.videoScript;
      const vo = vs?.voiceoverText?.trim();
      if (vo && vo.length > 15) {
        return {
          displayVoiceText: TurkishPhoneticNormalizer.toWrittenDisplayTurkish(vo),
          phoneticText: vs?.voiceoverPhoneticTr?.trim() || undefined,
          styleDirective: vs?.speechStyleDirective?.trim() || undefined,
          emotionPreset: vs?.emotionPreset,
        };
      }
    }
    for (const content of Object.values(deliveries)) {
      const vs = content?.videoScript;
      if (vs?.voiceoverText?.trim()) {
        return {
          displayVoiceText: TurkishPhoneticNormalizer.toWrittenDisplayTurkish(
            vs.voiceoverText.trim()
          ),
          phoneticText: vs.voiceoverPhoneticTr?.trim() || undefined,
          styleDirective: vs.speechStyleDirective?.trim() || undefined,
          emotionPreset: vs.emotionPreset,
        };
      }
    }
    const primary = Object.values(deliveries)[0];
    if (primary) {
      return {
        displayVoiceText: `${primary.hookText || primary.headline}. ${primary.caption.slice(0, 220)}`,
      };
    }
    return { displayVoiceText: fallbackTitle };
  }

  /**
   * MOD B: Kullanıcının yüklediği ham videoyu işler, gerçek ses transkripti çıkarır,
   * YALNIZCA markanın HEALTHY platformlarına özgü metin üretir, denetler (gerekirse revize eder),
   * kurumsal kimlik katmanlarıyla dikey videoyu kurgulayıp Lappsoft Social Hub'a ONAY BEKLİYOR olarak bırakır.
   */
  static async bakeFromRawVideo(opts: BakeVideoOptions): Promise<BakedPackage> {
    const { socialBrand, knowledge: brand } =
      await BrandKnowledgeStore.resolveBrandForProduction(opts.brandSlug);

    const targetPlatforms = this.resolveHealthyTargetPlatforms(
      socialBrand.healthyPlatforms,
      opts.targetPlatforms
    );

    const config = loadToprakConfig();
    const batchId = `toprak_${brand.slug}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const workDir = path.join(config.storageDir, "baked", batchId);
    fs.mkdirSync(workDir, { recursive: true });

    console.log(
      `[Toprak Fırını] 🍞 MOD B Başlatıldı: ${batchId} | Marka: ${brand.name} | Sağlıklı Platformlar: [${targetPlatforms.join(", ")}]`
    );

    // 1. Sesi videodan ayır
    console.log(`[Toprak Ingestion] 1/7 Ses videodan ayıklanıyor...`);
    const audioRes = await AudioExtractor.extractAudio(opts.videoPath, workDir);

    // 2. Merkezi AI Hub üzerinden gerçek ses transkripsiyonu
    console.log(`[Toprak Ingestion] 2/7 Ses transkripti çıkarılıyor...`);
    const transcriptRes = await Transcriber.transcribe(audioRes.audioPath, workDir);

    // 3. Sağlıklı platformlara özgü üretim paketi (CopywriterAgent)
    console.log(`[Toprak Copywriter] 3/7 Sağlıklı platformlara özel içerikler yazılıyor...`);
    let fullPkg: FullProductionPackage = await CopywriterAgent.createProductionPackage(
      brand,
      transcriptRes.fullText,
      { targetPlatforms }
    );
    let deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
    const primaryContent = this.pickPrimaryContent(deliveries, targetPlatforms);
    const coverTitle = primaryContent?.headline || `${brand.name}`;

    // 4. Cast Ajansı + Görsel/Video Prompt Tasarımı
    console.log(`[Toprak PromptArchitect] 4/7 Cast seçimi ve prodüksiyon promptları hazırlanıyor...`);
    const productionPrompts = await PromptArchitect.designPrompts({
      brand,
      topic: transcriptRes.fullText.slice(0, 240),
      headline: coverTitle,
      hookText: primaryContent?.hookText,
      scriptSnippet: transcriptRes.fullText.slice(0, 240),
      targetPlatform: targetPlatforms[0],
    });

    // 5. Bağımsız Denetim Konseyi + 1 Kademeli Otomatik Revizyon Döngüsü
    console.log(`[Toprak Validator] 5/7 Bağımsız kalite ve marka denetimi yapılıyor...`);
    let validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
    let revisionCount = 0;

    if (validation.status !== "APPROVED") {
      console.log(
        `[Toprak Orchestrator] 🔄 İlk denetim sonucu '${validation.status}' (${validation.overallScore}/100). Otomatik revizyon döngüsü başlatılıyor...`
      );
      fullPkg = await CopywriterAgent.reviseProductionPackage(
        brand,
        fullPkg,
        validation,
        targetPlatforms
      );
      deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
      revisionCount = 1;
      validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
      console.log(
        `[Toprak Orchestrator] ✅ Revizyon sonrası yeni denetim skoru: ${validation.overallScore}/100 (${validation.status})`
      );
    }

    // 6. Kurumsal Kimlik Kitinin Hazırlanması + Medya Montajı
    console.log(`[Toprak Media] 6/7 Kurumsal kimlikli dikey video ve editoryal kapak hazırlanıyor...`);
    const finalPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const finalCoverTitle = finalPrimary?.headline || coverTitle;

    const brandKit = await BrandAssetResolver.prepareVideoBrandKit(brand, workDir, {
      headline: finalCoverTitle,
      callToAction: finalPrimary?.callToAction,
    });

    const assPath = path.join(workDir, "subtitles.ass");
    SubtitleGenerator.generateAss(transcriptRes.words, assPath, {
      fontName: brandKit.identity.assFontName,
      accentColorHex: brandKit.identity.accentColor,
      brandKeywords: [brand.name, ...brand.name.split(/\s+/)],
    });

    const renderedVideoPath = path.join(workDir, "vertical_reels.mp4");
    await VideoAssembler.assembleVerticalVideo({
      inputVideoPath: opts.videoPath,
      outputPath: renderedVideoPath,
      subtitleAssPath: assPath,
      brandKit,
    });

    const coverPath = path.join(workDir, "cover_thumbnail.png");
    await ThumbnailGenerator.generateThumbnail({
      title: finalCoverTitle,
      brand,
      outputPath: coverPath,
      aspectRatio: "9:16",
    });

    const probedVideoDur =
      (await VideoAssembler.probeDurationSec(renderedVideoPath)) ||
      transcriptRes.durationSec ||
      audioRes.durationSec ||
      10;

    const videoAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "VIDEO_VERTICAL",
      aspectRatio: "9:16",
      localFilePath: renderedVideoPath,
      fileName: path.basename(renderedVideoPath),
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationSec: Math.max(1, Math.round(probedVideoDur)),
      fileSizeBytes: fs.statSync(renderedVideoPath).size,
    };

    const thumbnailAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "THUMBNAIL",
      aspectRatio: "9:16",
      localFilePath: coverPath,
      fileName: path.basename(coverPath),
      mimeType: "image/png",
      width: 1080,
      height: 1920,
      fileSizeBytes: fs.statSync(coverPath).size,
    };

    const bakedPackage: BakedPackage = {
      batchId,
      sourceMode: "MOD_B_INJECTION",
      createdAt: new Date().toISOString(),
      brand: {
        slug: brand.slug,
        name: brand.name,
        sector: brand.sector,
      },
      sourceMetadata: {
        rawFileName: path.basename(opts.videoPath),
        rawDurationSec: transcriptRes.durationSec,
        topic: finalCoverTitle,
        summary: transcriptRes.fullText.slice(0, 400),
      },
      productionPrompts,
      media: {
        videoVertical: videoAsset,
        thumbnail: thumbnailAsset,
        additionalAssets: [],
      },
      deliveries,
      validation,
      revisionCount,
      status: validation.status === "REJECTED" ? "FAILED" : "BAKED_READY",
    };

    // 7. Social Hub'a ONAY BEKLİYOR (PENDING_APPROVAL) Olarak Aktarım
    await this.handoffAndLearn(bakedPackage, brand, fullPkg, opts.autoInject !== false);

    PackageExporter.exportPackage(bakedPackage, path.join(config.storageDir, "baked"));
    console.log(`[Toprak Fırını] ✅ MOD B Tamamlandı! Konum: ${workDir}`);
    return bakedPackage;
  }

  /**
   * MOD A: Otonom trend araştırması yapar, YALNIZCA markanın HEALTHY platformlarına özgü
   * metin, kurumsal kimlikli kapak ve duygulu/doğal hızlı Türkçe seslendirmeli dikey video üretir,
   * denetler ve Social Hub'a ONAY BEKLİYOR olarak bırakır.
   */
  static async bakeFromTrendTopic(opts: BakeTopicOptions): Promise<BakedPackage> {
    const { socialBrand, knowledge: brand } =
      await BrandKnowledgeStore.resolveBrandForProduction(opts.brandSlug);

    const targetPlatforms = this.resolveHealthyTargetPlatforms(
      socialBrand.healthyPlatforms,
      opts.targetPlatforms
    );

    const config = loadToprakConfig();
    const batchId = `toprak_${brand.slug}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const workDir = path.join(config.storageDir, "baked", batchId);
    fs.mkdirSync(workDir, { recursive: true });

    console.log(
      `[Toprak Fırını] 🍞 MOD A Başlatıldı: ${batchId} | Marka: ${brand.name} | Sağlıklı Platformlar: [${targetPlatforms.join(", ")}]`
    );

    // 1. Etkinlik/Senaryo Çapraz Kurra Motoru + Trend İstihbaratı / Özel Konu
    let topicOrTrend: string | TrendIdeaDeep;
    let summaryText: string;
    let activeScenario: ScenarioDefinition | undefined;

    if (opts.customTopic && opts.customTopic.trim().length > 0) {
      topicOrTrend = opts.customTopic.trim();
      summaryText = opts.customTopic.trim();
      activeScenario = ScenarioManager.matchScenarioFromTopic(
        brand,
        opts.customTopic.trim(),
        true
      );
    } else {
      activeScenario = ScenarioManager.selectNextScenario(brand);
      console.log(
        `[Toprak TrendAgent] 1/7 Marka DNA'sına uygun trend ve kanca keşfediliyor${activeScenario ? ` (Senaryo: ${activeScenario.titleTr})` : ""}...`
      );
      const trendReport = await TrendAgent.analyzeAndDiscoverTrends(brand, {
        count: 2,
        targetPlatforms,
        scenario: activeScenario,
      });
      const chosenIdea = trendReport.ideas[0];
      topicOrTrend = chosenIdea;
      summaryText = `${chosenIdea.trendTitle} — ${chosenIdea.suggestedAngle} (${chosenIdea.marketInsight})`;
    }

    // 2. Sağlıklı Platformlara Özgü Üretim Paketi (CopywriterAgent)
    console.log(`[Toprak Copywriter] 2/7 ${targetPlatforms.length} sağlıklı platform için özgün içerikler yazılıyor...`);
    let fullPkg: FullProductionPackage = await CopywriterAgent.createProductionPackage(
      brand,
      topicOrTrend,
      { targetPlatforms, scenario: activeScenario }
    );
    let deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
    const initialPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const initialTitle = initialPrimary?.headline || summaryText.slice(0, 60);

    // 3. Cast Ajansı + Sinematik Görsel/Video Prompt Tasarımı (PromptArchitect)
    console.log(`[Toprak PromptArchitect] 3/7 Cast modeli seçiliyor ve prodüksiyon promptları tasarlanıyor...`);
    const initialVoicePlan = this.extractBestVoiceoverPlan(deliveries, initialTitle);
    const productionPrompts = await PromptArchitect.designPrompts({
      brand,
      topic: summaryText,
      headline: initialTitle,
      hookText: initialPrimary?.hookText,
      scriptSnippet: initialVoicePlan.displayVoiceText,
      targetPlatform: targetPlatforms[0],
      formatType: "VERTICAL_VIDEO",
      scenario: activeScenario,
    });

    // 4. Bağımsız Kalite Denetimi + 1 Kademeli Revizyon Döngüsü (ValidatorAgent)
    console.log(`[Toprak Validator] 4/7 Bağımsız model ailesi ile kalite denetimi yapılıyor...`);
    let validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
    let revisionCount = 0;

    if (validation.status !== "APPROVED") {
      console.log(
        `[Toprak Orchestrator] 🔄 İlk denetim '${validation.status}' (${validation.overallScore}/100). Otomatik revizyon döngüsü devrede...`
      );
      fullPkg = await CopywriterAgent.reviseProductionPackage(
        brand,
        fullPkg,
        validation,
        targetPlatforms
      );
      deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
      revisionCount = 1;
      validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
      console.log(
        `[Toprak Orchestrator] ✅ Revizyon sonrası yeni denetim skoru: ${validation.overallScore}/100 (${validation.status})`
      );
    }

    const finalPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const coverTitle = finalPrimary?.headline || initialTitle;
    const finalVoicePlan = this.extractBestVoiceoverPlan(deliveries, coverTitle);

    // 5. Kurumsal Görsel Kimlik Kiti + Sahne Fotoğrafı + Editoryal Kapak
    console.log(`[Toprak Media] 5/7 Sahne fotoğrafı, C:\\ kurumsal logo kiti ve editoryal kapak üretiliyor...`);
    const brandKit = await BrandAssetResolver.prepareVideoBrandKit(brand, workDir, {
      headline: coverTitle,
      callToAction: finalPrimary?.callToAction,
    });

    const photoPath = path.join(workDir, "cover_photo.jpg");
    await ImageGenerator.generatePhoto({
      prompt: productionPrompts.photoPrompt.masterPromptEn,
      brand,
      outputPath: photoPath,
      aspectRatio: "9:16",
    });

    const coverPath = path.join(workDir, "cover_thumbnail.png");
    await ThumbnailGenerator.generateThumbnail({
      title: coverTitle,
      brand,
      outputPath: coverPath,
      backgroundImagePath: fs.existsSync(photoPath) ? photoPath : undefined,
      aspectRatio: "9:16",
    });

    // 6. Duygulu & Doğal Hızlı Türkçe Seslendirme + Kurumsal Katmanlı 9:16 Reels Kurgusu
    console.log(`[Toprak Media] 6/7 Duygulu Türkçe seslendirme (AI->A-İ) ve kurumsal kimlikli 9:16 Reels videosu kurgulanıyor...`);
    const audioPath = path.join(workDir, "voiceover.mp3");
    await TtsEngine.synthesize({
      text: finalVoicePlan.displayVoiceText,
      phoneticText: finalVoicePlan.phoneticText,
      styleDirective: finalVoicePlan.styleDirective,
      emotionPreset: finalVoicePlan.emotionPreset,
      brandSlug: brand.slug,
      preferredGeminiVoice: brandKit.identity.defaultGeminiVoice,
      voiceGender:
        productionPrompts.voiceAndAudioPrompt?.voiceGender ||
        brandKit.identity.defaultVoiceGender,
      outputPath: audioPath,
      language: brand.defaultLanguage || "tr",
    });

    const audioDurationSec = (await VideoAssembler.probeDurationSec(audioPath)) || 7;
    const estimatedWords = SubtitleGenerator.estimateWordTimestamps(
      finalVoicePlan.displayVoiceText,
      audioDurationSec
    );
    const assPath = path.join(workDir, "subtitles.ass");
    if (estimatedWords.length > 0) {
      SubtitleGenerator.generateAss(estimatedWords, assPath, {
        fontName: brandKit.identity.assFontName,
        accentColorHex: brandKit.identity.accentColor,
        brandKeywords: [brand.name, ...brand.name.split(/\s+/)],
      });
    }

    const videoPath = path.join(workDir, "vertical_reels.mp4");
    await VideoAssembler.assembleMotionVideoFromImage({
      imagePath: fs.existsSync(photoPath) ? photoPath : coverPath,
      outputPath: videoPath,
      audioPath: fs.existsSync(audioPath) ? audioPath : undefined,
      subtitleAssPath: fs.existsSync(assPath) ? assPath : undefined,
      brandKit,
      durationSec: Math.max(5, Math.ceil(audioDurationSec + 0.4)),
    });

    const finalVideoDurationSec =
      (await VideoAssembler.probeDurationSec(videoPath)) ||
      Math.max(7, Math.ceil(audioDurationSec + 2.2));

    const thumbnailAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "THUMBNAIL",
      aspectRatio: "9:16",
      localFilePath: coverPath,
      fileName: path.basename(coverPath),
      mimeType: "image/png",
      width: 1080,
      height: 1920,
      fileSizeBytes: fs.statSync(coverPath).size,
    };

    const videoAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "VIDEO_VERTICAL",
      aspectRatio: "9:16",
      localFilePath: videoPath,
      fileName: path.basename(videoPath),
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationSec: Math.max(1, Math.round(finalVideoDurationSec)),
      fileSizeBytes: fs.statSync(videoPath).size,
    };

    const photoAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "IMAGE_CARD",
      aspectRatio: "9:16",
      localFilePath: photoPath,
      fileName: path.basename(photoPath),
      mimeType: "image/jpeg",
      width: 1080,
      height: 1920,
      fileSizeBytes: fs.statSync(photoPath).size,
    };

    const audioAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "AUDIO",
      aspectRatio: "1:1",
      localFilePath: audioPath,
      fileName: path.basename(audioPath),
      mimeType: "audio/mpeg",
      durationSec: Math.max(1, Math.round(audioDurationSec)),
      fileSizeBytes: fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0,
    };

    const bakedPackage: BakedPackage = {
      batchId,
      sourceMode: "MOD_A_AUTONOMOUS",
      createdAt: new Date().toISOString(),
      brand: {
        slug: brand.slug,
        name: brand.name,
        sector: brand.sector,
      },
      sourceMetadata: {
        topic: coverTitle,
        summary: summaryText,
      },
      productionPrompts,
      media: {
        videoVertical: videoAsset,
        thumbnail: thumbnailAsset,
        additionalAssets: [photoAsset, audioAsset],
      },
      deliveries,
      validation,
      revisionCount,
      status: validation.status === "REJECTED" ? "FAILED" : "BAKED_READY",
    };

    // 7. Social Hub'a ONAY BEKLİYOR (PENDING_APPROVAL) Olarak Aktarım
    await this.handoffAndLearn(bakedPackage, brand, fullPkg, opts.autoInject !== false);

    PackageExporter.exportPackage(bakedPackage, path.join(config.storageDir, "baked"));
    console.log(`[Toprak Fırını] ✅ MOD A Tamamlandı! Konum: ${workDir}`);
    return bakedPackage;
  }

  /**
   * Lappsoft Social üzerinde HEALTHY hesabı bulunan TÜM markalar için sırasıyla
   * sağlıklı platformlarına özel içerik üretir ve hepsini Social'da ONAY BEKLİYOR durumuna düşürür.
   */
  static async bakeForAllHealthyBrands(): Promise<BatchBakeSummary> {
    const qualifiedBrands = await BrandDiscovery.getQualifiedBrands();
    const succeeded: BakedPackage[] = [];
    const failed: Array<{ brandSlug: string; error: string }> = [];

    console.log(
      `[Toprak Orchestrator] 🌾 Toplu Üretim Başlatıldı: ${qualifiedBrands.length} sağlıklı marka bulundu.`
    );

    for (const qb of qualifiedBrands) {
      try {
        const pkg = await this.bakeFromTrendTopic({
          brandSlug: qb.slug,
          targetPlatforms: qb.healthyPlatforms,
          autoInject: true,
        });
        succeeded.push(pkg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Toprak Orchestrator] ❌ ${qb.slug} üretimi başarısız:`, msg);
        failed.push({ brandSlug: qb.slug, error: msg });
      }
    }

    return {
      totalQualifiedBrands: qualifiedBrands.length,
      succeeded,
      failed,
    };
  }

  /**
   * YARI-OTONOM GEMINI PRO WEB STÜDYO MODU — ADIM 1:
   * Ücretsiz metin konseyiyle tüm sağlıklı platform metinlerini, X slaytlarını ve
   * kullanıcının Gemini Pro Web (gemini.google.com) ekranına yapıştıracağı hazır
   * Veo 9:16 Video & 9:16 Görsel promptlarını üretip taslak olarak kaydeder.
   */
  static async prepareGeminiStudioDraft(
    opts: BakeTopicOptions
  ): Promise<GeminiStudioDraft> {
    const { socialBrand, knowledge: brand } =
      await BrandKnowledgeStore.resolveBrandForProduction(opts.brandSlug);

    const targetPlatforms = this.resolveHealthyTargetPlatforms(
      socialBrand.healthyPlatforms,
      opts.targetPlatforms
    );

    const config = loadToprakConfig();
    const batchId = `toprak_${brand.slug}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const workDir = path.join(config.storageDir, "baked", batchId);
    fs.mkdirSync(workDir, { recursive: true });

    console.log(
      `[Toprak GeminiPro Studio] ✨ ADIM 1 Başlatıldı: ${batchId} | Marka: ${brand.name}`
    );

    let topicOrTrend: string | TrendIdeaDeep;
    let summaryText: string;
    let activeScenario: ScenarioDefinition | undefined;

    if (opts.customTopic && opts.customTopic.trim().length > 0) {
      topicOrTrend = opts.customTopic.trim();
      summaryText = opts.customTopic.trim();
      activeScenario = ScenarioManager.matchScenarioFromTopic(
        brand,
        opts.customTopic.trim(),
        true
      );
    } else {
      activeScenario = ScenarioManager.selectNextScenario(brand);
      const trendReport = await TrendAgent.analyzeAndDiscoverTrends(brand, {
        count: 2,
        targetPlatforms,
        scenario: activeScenario,
      });
      const chosenIdea = trendReport.ideas[0];
      topicOrTrend = chosenIdea;
      summaryText = `${chosenIdea.trendTitle} — ${chosenIdea.suggestedAngle} (${chosenIdea.marketInsight})`;
    }

    let fullPkg: FullProductionPackage = await CopywriterAgent.createProductionPackage(
      brand,
      topicOrTrend,
      { targetPlatforms, scenario: activeScenario }
    );
    let deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
    const initialPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const initialTitle = initialPrimary?.headline || summaryText.slice(0, 60);

    const initialVoicePlan = this.extractBestVoiceoverPlan(deliveries, initialTitle);
    const productionPrompts = await PromptArchitect.designPrompts({
      brand,
      topic: summaryText,
      headline: initialTitle,
      hookText: initialPrimary?.hookText,
      scriptSnippet: initialVoicePlan.displayVoiceText,
      targetPlatform: targetPlatforms[0],
      formatType: "VERTICAL_VIDEO",
      scenario: activeScenario,
    });

    let validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
    let revisionCount = 0;

    if (validation.status !== "APPROVED") {
      fullPkg = await CopywriterAgent.reviseProductionPackage(
        brand,
        fullPkg,
        validation,
        targetPlatforms
      );
      deliveries = CopywriterAgent.toPlatformContents(fullPkg, targetPlatforms);
      revisionCount = 1;
      validation = await ValidatorAgent.validate(brand, fullPkg, productionPrompts);
    }

    const finalPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const coverTitle = finalPrimary?.headline || initialTitle;
    const finalVoicePlan = this.extractBestVoiceoverPlan(deliveries, coverTitle);
    const createdAt = new Date().toISOString();

    const storedDraft: StoredStudioDraftFile = {
      batchId,
      createdAt,
      brand,
      targetPlatforms,
      coverTitle,
      summaryText,
      scenarioTitle: activeScenario?.titleTr,
      fullPkg,
      deliveries,
      productionPrompts,
      validation,
      revisionCount,
      voicePlan: finalVoicePlan,
    };

    fs.writeFileSync(
      path.join(workDir, "studio_draft.json"),
      JSON.stringify(storedDraft, null, 2),
      "utf-8"
    );

    const vp = productionPrompts.videoPrompt;
    const pp = productionPrompts.photoPrompt;

    const geminiProVideoPrompt = [
      `Create a vertical 9:16 photorealistic cinematic video (no text, no words, no watermarks on screen):`,
      vp.masterPromptEn,
      `Camera & Lighting: ${vp.cameraMovement}, ${vp.lensAndAperture}, ${vp.lightingAndAtmosphere}.`,
      `Action: ${vp.actionChoreography}.`,
      `Important: Keep clean composition in 9:16 portrait format without any embedded letters or UI text overlays.`,
    ].join("\n");

    const geminiProImagePrompt = [
      `Create a vertical 9:16 high-end commercial editorial photograph (no text, no letters, no watermarks):`,
      pp.masterPromptEn,
      `Composition & Lighting: ${pp.composition}, ${pp.lighting}.`,
      `Important: Leave clean negative space at top and bottom for brand graphic overlay; do not render any text inside the photo.`,
    ].join("\n");

    return {
      batchId,
      brandSlug: brand.slug,
      brandName: brand.name,
      topic: coverTitle,
      summaryText,
      scenarioTitle: activeScenario?.titleTr,
      targetPlatforms,
      geminiProVideoPrompt,
      geminiProImagePrompt,
      voiceoverPreviewText: finalVoicePlan.displayVoiceText,
      validationScore: validation.overallScore,
      validationStatus: validation.status,
      deliveries,
      createdAt,
    };
  }

  /**
   * YARI-OTONOM GEMINI PRO WEB STÜDYO MODU — ADIM 2:
   * Kullanıcının Gemini Pro penceresinden indirip bıraktığı Veo videosunu (.mp4) ve/veya görseli (.png/.jpg) alır;
   * üzerine markanın kurumsal SVG logosunu, orta bilgi bandını, AI->A-İ duygulu Türkçe seslendirmesini,
   * altyazısını ve küçük harfli çift web adresli kapanış kartını basıp Social 'Onay Bekliyor' kuyruğuna gönderir.
   */
  static async finalizeGeminiStudioDraft(
    opts: FinalizeGeminiStudioOptions
  ): Promise<BakedPackage> {
    const config = loadToprakConfig();
    const workDir = path.join(config.storageDir, "baked", opts.batchId);
    const draftPath = path.join(workDir, "studio_draft.json");

    if (!fs.existsSync(draftPath)) {
      throw new Error(`Stüdyo taslağı bulunamadı: ${opts.batchId}`);
    }

    const draft = JSON.parse(
      fs.readFileSync(draftPath, "utf-8")
    ) as StoredStudioDraftFile;

    const {
      brand,
      targetPlatforms,
      coverTitle,
      summaryText,
      fullPkg,
      deliveries,
      productionPrompts,
      validation,
      revisionCount,
      voicePlan,
    } = draft;

    console.log(
      `[Toprak GeminiPro Studio] 🚀 ADIM 2 Kurumsal Montaj Başlatıldı: ${opts.batchId} (${brand.name})`
    );

    const finalPrimary = this.pickPrimaryContent(deliveries, targetPlatforms);
    const brandKit = await BrandAssetResolver.prepareVideoBrandKit(brand, workDir, {
      headline: coverTitle,
      callToAction: finalPrimary?.callToAction,
    });

    const hasUploadedVideo = Boolean(
      opts.uploadedVideoPath && fs.existsSync(opts.uploadedVideoPath)
    );
    const hasUploadedImage = Boolean(
      opts.uploadedImagePath && fs.existsSync(opts.uploadedImagePath)
    );

    // 1. Sahne / Kapak Fotoğrafını Hazırla (Yüklenen görsel -> yoksa yüklenen videodan kare -> yoksa ImageGenerator)
    const photoPath = path.join(workDir, "cover_photo.jpg");
    if (hasUploadedImage && opts.uploadedImagePath) {
      await sharp(opts.uploadedImagePath)
        .resize(1080, 1920, { fit: "cover", position: "attention" })
        .jpeg({ quality: 92 })
        .toFile(photoPath);
    } else if (hasUploadedVideo && opts.uploadedVideoPath) {
      const extracted = await VideoAssembler.extractCoverFrame(
        opts.uploadedVideoPath,
        photoPath,
        1.2
      );
      if (!extracted) {
        await ImageGenerator.generatePhoto({
          prompt: productionPrompts.photoPrompt.masterPromptEn,
          brand,
          outputPath: photoPath,
          aspectRatio: "9:16",
        });
      }
    } else {
      await ImageGenerator.generatePhoto({
        prompt: productionPrompts.photoPrompt.masterPromptEn,
        brand,
        outputPath: photoPath,
        aspectRatio: "9:16",
      });
    }

    // 2. Kurumsal Tipografik Kapak (Logo + Başlık + modenamoda.com.tr + lappsoft.com/projects/modena)
    const coverPath = path.join(workDir, "cover_thumbnail.png");
    await ThumbnailGenerator.generateThumbnail({
      title: coverTitle,
      brand,
      outputPath: coverPath,
      backgroundImagePath: fs.existsSync(photoPath) ? photoPath : undefined,
      aspectRatio: "9:16",
    });

    // 3. Türkçe Duygulu Seslendirme (AI->A-İ, ~148 WPM) + Altyazı
    const audioMode = opts.audioMode || "TOPRAK_TTS_MIX";
    const audioPath = path.join(workDir, "voiceover.mp3");
    const assPath = path.join(workDir, "subtitles.ass");
    let audioDurationSec = 8;

    const shouldSynthesizeTts =
      !hasUploadedVideo || audioMode === "TOPRAK_TTS_MIX";

    if (shouldSynthesizeTts) {
      await TtsEngine.synthesize({
        text: voicePlan.displayVoiceText,
        phoneticText: voicePlan.phoneticText,
        styleDirective: voicePlan.styleDirective,
        emotionPreset: voicePlan.emotionPreset,
        brandSlug: brand.slug,
        preferredGeminiVoice: brandKit.identity.defaultGeminiVoice,
        voiceGender:
          productionPrompts.voiceAndAudioPrompt?.voiceGender ||
          brandKit.identity.defaultVoiceGender,
        outputPath: audioPath,
        language: brand.defaultLanguage || "tr",
      });

      audioDurationSec = (await VideoAssembler.probeDurationSec(audioPath)) || 7;
      const estimatedWords = SubtitleGenerator.estimateWordTimestamps(
        voicePlan.displayVoiceText,
        audioDurationSec
      );
      if (estimatedWords.length > 0) {
        SubtitleGenerator.generateAss(estimatedWords, assPath, {
          fontName: brandKit.identity.assFontName,
          accentColorHex: brandKit.identity.accentColor,
          brandKeywords: [brand.name, ...brand.name.split(/\s+/)],
        });
      }
    }

    // 4. 9:16 Kurumsal Dikey Video Kurgusu (Veo Video Klibi veya Görsel Üzerinden)
    const videoPath = path.join(workDir, "vertical_reels.mp4");
    if (hasUploadedVideo && opts.uploadedVideoPath) {
      await VideoAssembler.assembleGeminiProClip({
        inputVideoPath: opts.uploadedVideoPath,
        outputPath: videoPath,
        audioMode,
        ttsAudioPath: fs.existsSync(audioPath) ? audioPath : undefined,
        subtitleAssPath: fs.existsSync(assPath) ? assPath : undefined,
        brandKit,
      });
    } else {
      await VideoAssembler.assembleMotionVideoFromImage({
        imagePath: fs.existsSync(photoPath) ? photoPath : coverPath,
        outputPath: videoPath,
        audioPath: fs.existsSync(audioPath) ? audioPath : undefined,
        subtitleAssPath: fs.existsSync(assPath) ? assPath : undefined,
        brandKit,
        durationSec: Math.max(5, Math.ceil(audioDurationSec + 0.4)),
      });
    }

    const finalVideoDurationSec =
      (await VideoAssembler.probeDurationSec(videoPath)) ||
      Math.max(7, Math.ceil(audioDurationSec + 2.2));

    const thumbnailAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "THUMBNAIL",
      aspectRatio: "9:16",
      localFilePath: coverPath,
      fileName: path.basename(coverPath),
      mimeType: "image/png",
      width: 1080,
      height: 1920,
      fileSizeBytes: fs.statSync(coverPath).size,
    };

    const videoAsset: MediaAsset = {
      id: crypto.randomUUID(),
      kind: "VIDEO_VERTICAL",
      aspectRatio: "9:16",
      localFilePath: videoPath,
      fileName: path.basename(videoPath),
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      durationSec: Math.max(1, Math.round(finalVideoDurationSec)),
      fileSizeBytes: fs.statSync(videoPath).size,
    };

    const additionalAssets: MediaAsset[] = [];
    if (fs.existsSync(photoPath)) {
      additionalAssets.push({
        id: crypto.randomUUID(),
        kind: "IMAGE_CARD",
        aspectRatio: "9:16",
        localFilePath: photoPath,
        fileName: path.basename(photoPath),
        mimeType: "image/jpeg",
        width: 1080,
        height: 1920,
        fileSizeBytes: fs.statSync(photoPath).size,
      });
    }
    if (fs.existsSync(audioPath)) {
      additionalAssets.push({
        id: crypto.randomUUID(),
        kind: "AUDIO",
        aspectRatio: "1:1",
        localFilePath: audioPath,
        fileName: path.basename(audioPath),
        mimeType: "audio/mpeg",
        durationSec: Math.max(1, Math.round(audioDurationSec)),
        fileSizeBytes: fs.statSync(audioPath).size,
      });
    }

    const bakedPackage: BakedPackage = {
      batchId: opts.batchId,
      sourceMode: "MOD_A_AUTONOMOUS",
      createdAt: draft.createdAt,
      brand: {
        slug: brand.slug,
        name: brand.name,
        sector: brand.sector,
      },
      sourceMetadata: {
        topic: coverTitle,
        summary: summaryText,
      },
      productionPrompts,
      media: {
        videoVertical: videoAsset,
        thumbnail: thumbnailAsset,
        additionalAssets,
      },
      deliveries,
      validation,
      revisionCount,
      status: validation.status === "REJECTED" ? "FAILED" : "BAKED_READY",
    };

    await this.handoffAndLearn(bakedPackage, brand, fullPkg, opts.autoInject !== false);
    PackageExporter.exportPackage(bakedPackage, path.join(config.storageDir, "baked"));
    console.log(
      `[Toprak GeminiPro Studio] ✅ Kurumsal paket tamamlandı ve Social onayına bırakıldı: ${workDir}`
    );
    return bakedPackage;
  }

  private static async handoffAndLearn(
    bakedPackage: BakedPackage,
    brand: BrandKnowledge,
    fullPkg: FullProductionPackage,
    shouldInject: boolean
  ): Promise<void> {
    if (bakedPackage.validation.status === "REJECTED") {
      console.warn(
        `[Toprak Orchestrator] ⛔ Paket revizyona rağmen REJECTED (${bakedPackage.validation.overallScore}/100) kaldı; Social Hub'a kusurlu içerik aktarılmadı.`
      );
      bakedPackage.status = "FAILED";
      return;
    }

    if (shouldInject) {
      const injectResult = await SocialInjector.inject(bakedPackage, {
        fullProductionPackage: fullPkg,
        targetLanguage: brand.defaultLanguage || "tr",
      });

      bakedPackage.socialHandoff = {
        postId: injectResult.postId,
        sourceRef: injectResult.sourceRef,
        approvalStatus: "PENDING_APPROVAL",
        pushedAutomatically: false,
        deliveriesCount: injectResult.deliveries.length,
        injectedAt: new Date().toISOString(),
      };
      bakedPackage.status = "PENDING_SOCIAL_APPROVAL";
    }

    try {
      await LearningEngine.analyzeBrandPerformance(brand.slug);
    } catch (learnErr) {
      console.warn(`[Toprak Orchestrator] ⚠️ Öğrenme motoru uyarısı:`, learnErr);
    }
  }
}
