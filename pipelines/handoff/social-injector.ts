import {
  SocialBridge,
  type ToprakBridgeDeliveryInput,
  type ToprakBridgeMediaInput,
} from "../../core/social-bridge";
import {
  BakedPackage,
  PlatformContent,
  ToprakPlatform,
  TOPRAK_PLATFORMS,
} from "../../core/types";
import type { FullProductionPackage } from "../../agents/copywriter-agent";
import type { DeliveryMode, PlatformId } from "../../../src/types";

export interface SocialInjectorOptions {
  /**
   * YENİ MİMARİ KURALI: Toprak hiçbir zaman otomatik yayına basmaz!
   * Tüm üretilen içerikler Social Hub'a ONAY BEKLİYOR (PENDING_APPROVAL / DRAFT) olarak düşer.
   * Onay işlemi yalnızca Lappsoft Social üzerinden manuel yapılır.
   */
  fullProductionPackage?: FullProductionPackage;
  targetLanguage?: "tr" | "en" | "de" | "ru" | "it" | "es" | "ar" | "zh";
}

export interface InjectedDeliverySummary {
  deliveryId: string;
  platform: ToprakPlatform;
  status: "DRAFT";
  deliveryMode: DeliveryMode;
  mediaCount: number;
}

export interface SocialInjectionResult {
  ok: boolean;
  batchId: string;
  postId: string;
  workspaceId: string;
  brandSlug: string;
  sourceRef: string;
  approvalStatus: "PENDING_APPROVAL";
  mediaAssetIds: string[];
  deliveries: InjectedDeliverySummary[];
  pushedAutomatically: false;
}

export class SocialInjector {
  /**
   * Toprak fırınından çıkan BakedPackage nesnesini SocialBridge aracılığıyla
   * Lappsoft Social Hub'a "ONAY BEKLİYOR" (PENDING_APPROVAL / DRAFT) durumunda aktarır.
   * - Yalnızca markanın HEALTHY hesaplarına teslimat kaydı açar.
   * - Asla sahte SANDBOX hesabı oluşturmaz.
   * - Asla otomatik publish (yayın) tetiklemez.
   */
  static async inject(
    pkg: BakedPackage,
    opts: SocialInjectorOptions = {}
  ): Promise<SocialInjectionResult> {
    console.log(
      `[Toprak SocialInjector] 📥 Social Hub 'Onay Bekliyor' aktarımı başlatılıyor: ${pkg.batchId} (${pkg.brand.name})`
    );

    const mediaFiles: ToprakBridgeMediaInput[] = [];

    if (pkg.media.videoVertical?.localFilePath) {
      mediaFiles.push({
        role: "VIDEO_VERTICAL",
        localFilePath: pkg.media.videoVertical.localFilePath,
        fileName: pkg.media.videoVertical.fileName,
        mimeType: pkg.media.videoVertical.mimeType || "video/mp4",
        aspectRatio: "9:16",
        width: 1080,
        height: 1920,
        durationSec: pkg.media.videoVertical.durationSec,
      });
    }

    if (pkg.media.thumbnail?.localFilePath) {
      mediaFiles.push({
        role: "THUMBNAIL",
        localFilePath: pkg.media.thumbnail.localFilePath,
        fileName: pkg.media.thumbnail.fileName,
        mimeType: pkg.media.thumbnail.mimeType || "image/png",
        aspectRatio: pkg.media.thumbnail.aspectRatio === "1:1" ? "1:1" : "9:16",
        width: 1080,
        height: pkg.media.thumbnail.aspectRatio === "1:1" ? 1080 : 1920,
      });
    }

    for (const extra of pkg.media.additionalAssets || []) {
      if (extra.kind === "IMAGE_CARD" && extra.localFilePath) {
        mediaFiles.push({
          role: "PHOTO_CARD",
          localFilePath: extra.localFilePath,
          fileName: extra.fileName,
          mimeType: extra.mimeType || "image/jpeg",
          aspectRatio: extra.aspectRatio === "1:1" ? "1:1" : "9:16",
          width: 1080,
          height: extra.aspectRatio === "1:1" ? 1080 : 1920,
        });
      }
    }

    const deliveryEntries = Object.entries(pkg.deliveries) as Array<
      [string, PlatformContent | undefined]
    >;

    const deliveries: ToprakBridgeDeliveryInput[] = [];
    for (const [rawPlatform, content] of deliveryEntries) {
      if (!content) continue;
      const platform = rawPlatform.toLowerCase() as ToprakPlatform;
      if (!TOPRAK_PLATFORMS.includes(platform)) continue;

      const richMeta = opts.fullProductionPackage?.platforms?.[platform];

      deliveries.push({
        platform: platform as PlatformId,
        headline: content.headline,
        caption: content.caption,
        hashtags: content.hashtags || [],
        callToAction: content.callToAction,
        formatType: richMeta?.formatDecision?.formatType,
        threadTweets: richMeta?.threadTweets,
        hasVideoScript: Boolean(content.videoScript),
      });
    }

    const firstDelivery = Object.values(pkg.deliveries)[0];
    const postTitle =
      pkg.sourceMetadata.topic ||
      firstDelivery?.headline ||
      `Toprak İçeriği (${pkg.brand.name})`;

    const seedText =
      pkg.sourceMetadata.summary ||
      firstDelivery?.caption ||
      postTitle;

    const bridgeRes = await SocialBridge.injectPendingApproval({
      batchId: pkg.batchId,
      brandSlug: pkg.brand.slug,
      title: postTitle,
      seedText,
      aiPrompt: pkg.productionPrompts?.videoPrompt?.masterPromptEn || null,
      targetLanguage: opts.targetLanguage || "tr",
      mediaFiles,
      deliveries,
    });

    console.log(
      `[Toprak SocialInjector] ✅ Social Hub'a ONAY BEKLİYOR olarak bırakıldı! Post ID: ${bridgeRes.postId} (${bridgeRes.deliveries.length} sağlıklı platform)`
    );

    return {
      ok: true,
      batchId: bridgeRes.batchId,
      postId: bridgeRes.postId,
      workspaceId: bridgeRes.workspaceId,
      brandSlug: bridgeRes.brandSlug,
      sourceRef: bridgeRes.sourceRef,
      approvalStatus: "PENDING_APPROVAL",
      mediaAssetIds: bridgeRes.mediaAssetIds,
      deliveries: bridgeRes.deliveries.map((d) => ({
        deliveryId: d.deliveryId,
        platform: d.platform as ToprakPlatform,
        status: "DRAFT",
        deliveryMode: d.deliveryMode,
        mediaCount: d.mediaCount,
      })),
      pushedAutomatically: false,
    };
  }
}
