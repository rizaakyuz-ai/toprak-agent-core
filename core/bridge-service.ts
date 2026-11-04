export type PlatformId =
  | "instagram"
  | "facebook"
  | "threads"
  | "tiktok"
  | "x"
  | "linkedin"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "github";

export type DeliveryMode = "API_PUSH" | "QUICK_INTENT" | "SANDBOX";
export type AccountHealthStatus = "CONNECTED" | "WARNING" | "EXPIRED" | "REVOKED";
export type ConnectionMode = "OFFICIAL_API" | "QUICK_INTENT" | "PLAYWRIGHT" | "MOCK";
export type LanguageCode = "tr" | "en" | "de" | "ru" | "it" | "es" | "ar" | "zh";
export type MediaAspectRatio = "9:16" | "16:9" | "1:1" | "4:5";

export interface ToprakBridgeAccountInfo {
  id: string;
  platform: PlatformId;
  connectionMode: ConnectionMode;
  healthStatus: AccountHealthStatus;
  handle: string;
  displayName: string;
}

export interface ToprakBridgeBrandInfo {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  accentColor: string;
  primaryColor: string;
  secondaryColor: string;
  defaultLanguage: LanguageCode;
  websiteUrl: string;
  toneOfVoice: string;
  targetAudience: string;
  defaultHashtags: string[];
  bannedWords: string[];
  healthyPlatforms: PlatformId[];
  accounts: ToprakBridgeAccountInfo[];
}

export interface ToprakBridgeMediaInput {
  role: "VIDEO_VERTICAL" | "THUMBNAIL" | "PHOTO_CARD";
  localFilePath: string;
  fileName: string;
  mimeType: string;
  aspectRatio: MediaAspectRatio;
  width?: number;
  height?: number;
  durationSec?: number;
}

export interface ToprakBridgeDeliveryInput {
  platform: PlatformId;
  headline: string;
  caption: string;
  hashtags: string[];
  callToAction?: string;
  formatType?: string;
  threadTweets?: string[];
  hasVideoScript?: boolean;
}

export interface ToprakBridgeInjectInput {
  batchId: string;
  brandSlug: string;
  title: string;
  seedText: string;
  aiPrompt?: string | null;
  targetLanguage?: LanguageCode;
  mediaFiles: ToprakBridgeMediaInput[];
  deliveries: ToprakBridgeDeliveryInput[];
}

export interface ToprakBridgeInjectedDelivery {
  deliveryId: string;
  platform: PlatformId;
  status: "DRAFT";
  deliveryMode: DeliveryMode;
  mediaCount: number;
}

export interface ToprakBridgeInjectResult {
  ok: true;
  batchId: string;
  postId: string;
  workspaceId: string;
  brandSlug: string;
  sourceRef: string;
  approvalStatus: "PENDING_APPROVAL";
  mediaAssetIds: string[];
  deliveries: ToprakBridgeInjectedDelivery[];
  error?: string;
}

export interface ToprakBridgeAnalyticsData {
  workspaceFound: boolean;
  brandName: string;
  publishedDeliveries: Array<{
    id: string;
    platform: PlatformId;
    adaptedText: string;
    hasVideo: boolean;
    publishedAt: string | null;
  }>;
  snapshots: Array<{
    postDeliveryId: string | null;
    socialAccountId: string | null;
    platform: PlatformId;
    impressions: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
    capturedAt: string;
  }>;
}

export async function listSocialBrandsForToprak(): Promise<ToprakBridgeBrandInfo[]> {
  return [
    {
      id: "brand-modena",
      slug: "modena",
      name: "Modena",
      isActive: true,
      accentColor: "#6366f1",
      primaryColor: "#4f46e5",
      secondaryColor: "#818cf8",
      defaultLanguage: "tr",
      websiteUrl: "https://modena.lappsoft.com",
      toneOfVoice: "Inspirational, technical, clear",
      targetAudience: "Engineers, founders, creators",
      defaultHashtags: ["#tech", "#software", "#engineering"],
      bannedWords: [],
      healthyPlatforms: ["x", "linkedin", "instagram"],
      accounts: [
        {
          id: "acc-x-modena",
          platform: "x",
          connectionMode: "OFFICIAL_API",
          healthStatus: "CONNECTED",
          handle: "@lappsoft_modena",
          displayName: "Modena Tech",
        },
      ],
    },
  ];
}

export async function getBrandPerformanceDataForToprak(
  brandSlug: string
): Promise<ToprakBridgeAnalyticsData> {
  return {
    workspaceFound: true,
    brandName: brandSlug.toUpperCase(),
    publishedDeliveries: [],
    snapshots: [],
  };
}

export async function receiveToprakPackageAsPendingApproval(
  input: ToprakBridgeInjectInput
): Promise<ToprakBridgeInjectResult> {
  return {
    ok: true,
    batchId: input.batchId,
    postId: `post_${Date.now()}`,
    workspaceId: "ws_default",
    brandSlug: input.brandSlug,
    sourceRef: `toprak_${Date.now()}`,
    approvalStatus: "PENDING_APPROVAL",
    mediaAssetIds: input.mediaFiles.map((_, i) => `media_${i}`),
    deliveries: input.deliveries.map((d, i) => ({
      deliveryId: `del_${Date.now()}_${i}`,
      platform: d.platform,
      status: "DRAFT",
      deliveryMode: "SANDBOX",
      mediaCount: input.mediaFiles.length,
    })),
  };
}
