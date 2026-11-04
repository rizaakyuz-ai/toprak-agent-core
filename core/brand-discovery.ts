import { SocialBridge } from "./social-bridge";
import { ToprakPlatform, TOPRAK_PLATFORMS } from "./types";

export interface QualifiedBrandAccount {
  platform: ToprakPlatform;
  connectionMode: "MANAGED_OAUTH" | "CUSTOM_BYOK" | "QUICK_INTENT" | "SANDBOX";
  healthStatus: "HEALTHY" | "EXPIRING_SOON" | "EXPIRED" | "DISCONNECTED";
  handle: string;
  displayName: string;
}

export interface QualifiedBrand {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string;
  primaryColor: string;
  accentColor: string;
  defaultLanguage: "tr" | "en" | "de" | "ru" | "it" | "es" | "ar" | "zh";
  toneOfVoice: string;
  targetAudience: string;
  defaultHashtags: string[];
  bannedWords: string[];
  healthyPlatforms: ToprakPlatform[];
  accounts: QualifiedBrandAccount[];
}

export class BrandDiscovery {
  /**
   * Lappsoft Social üzerindeki TÜM aktif markaları (workspace) ve hesap sağlık durumlarını döner.
   * Web arayüzü ve CLI marka listeleme ekranları tarafından kullanılır.
   */
  static async getAllActiveBrands(): Promise<QualifiedBrand[]> {
    const rawBrands = await SocialBridge.listBrands();

    return rawBrands.map((ws) => {
      const parsedAccounts: QualifiedBrandAccount[] = ws.accounts
        .filter((a: any) => TOPRAK_PLATFORMS.includes(a.platform as ToprakPlatform))
        .map((a: any) => ({
          platform: a.platform as ToprakPlatform,
          connectionMode: a.connectionMode,
          healthStatus: a.healthStatus,
          handle: a.handle,
          displayName: a.displayName,
        }));

      const healthyPlatforms = Array.from(
        new Set(
          parsedAccounts
            .filter((a: any) => a.healthStatus === "HEALTHY")
            .map((a: any) => a.platform)
        )
      );

      return {
        id: ws.id,
        slug: ws.slug,
        name: ws.name,
        websiteUrl: ws.websiteUrl?.trim() || "",
        primaryColor: ws.primaryColor || ws.accentColor || "#3b82f6",
        accentColor: ws.accentColor || "#3b82f6",
        defaultLanguage: ws.defaultLanguage || "tr",
        toneOfVoice: ws.toneOfVoice || "",
        targetAudience: ws.targetAudience || "",
        defaultHashtags: Array.isArray(ws.defaultHashtags) ? ws.defaultHashtags : [],
        bannedWords: Array.isArray(ws.bannedWords) ? ws.bannedWords : [],
        healthyPlatforms,
        accounts: parsedAccounts,
      };
    });
  }

  /**
   * KURAL: Yalnızca en az 1 sosyal medya hesabı healthStatus === 'HEALTHY' olan markaları döner.
   */
  static async getQualifiedBrands(): Promise<QualifiedBrand[]> {
    const all = await this.getAllActiveBrands();
    return all.filter((b) => b.healthyPlatforms.length > 0);
  }

  /**
   * Slug veya ID ile Social markasını bulur.
   */
  static async getBrandBySlug(slugOrId: string): Promise<QualifiedBrand | null> {
    const key = slugOrId.trim().toLowerCase();
    const all = await this.getAllActiveBrands();
    return (
      all.find(
        (b) => b.slug.toLowerCase() === key || b.id.toLowerCase() === key
      ) || null
    );
  }
}
