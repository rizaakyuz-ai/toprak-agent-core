import { loadToprakConfig } from "./config";
import {
  getBrandPerformanceDataForToprak,
  listSocialBrandsForToprak,
  receiveToprakPackageAsPendingApproval,
  type ToprakBridgeAnalyticsData,
  type ToprakBridgeBrandInfo,
  type ToprakBridgeDeliveryInput,
  type ToprakBridgeInjectInput,
  type ToprakBridgeInjectResult,
  type ToprakBridgeMediaInput,
} from "../../src/server/toprak-bridge/service";

export type {
  ToprakBridgeAnalyticsData,
  ToprakBridgeBrandInfo,
  ToprakBridgeDeliveryInput,
  ToprakBridgeInjectInput,
  ToprakBridgeInjectResult,
  ToprakBridgeMediaInput,
};

/**
 * Toprak <-> Lappsoft Social Hub Köprüsü.
 *
 * Öncelikle çalışan Lappsoft Social Hub sunucusuna (:3000/api/internal/toprak) HTTP üzerinden bağlanır.
 * Böylece PGlite veritabanı her iki süreç tarafından aynı anda açılıp bozulmaz ve Social kuyruğunda anında görünür.
 * Eğer Social Hub (:3000) o an kapalıysa (bağlantı reddedilirse), otomatik olarak doğrudan veritabanı servisine düşer.
 */
export class SocialBridge {
  private static isNetworkOfflineError(err: unknown): boolean {
    if (!err) return false;
    const msg = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause || "")}` : String(err);
    return (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("ECONNRESET") ||
      msg.includes("UND_ERR_CONNECT_TIMEOUT") ||
      msg.includes("TimeoutError") ||
      msg.includes("aborted")
    );
  }

  static async listBrands(): Promise<ToprakBridgeBrandInfo[]> {
    const config = loadToprakConfig();
    const url = `${config.socialBaseUrl.replace(/\/$/, "")}/api/internal/toprak?action=brands`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "x-toprak-bridge-key": config.bridgeSecret,
        },
        signal: AbortSignal.timeout(3500),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        brands?: ToprakBridgeBrandInfo[];
        error?: string;
      };

      if (!res.ok || !data.ok || !Array.isArray(data.brands)) {
        throw new Error(data.error || `Social HTTP ${res.status}`);
      }

      return data.brands;
    } catch (err) {
      if (this.isNetworkOfflineError(err)) {
        return await listSocialBrandsForToprak();
      }
      throw err;
    }
  }

  static async getBrandAnalytics(brandSlug: string): Promise<ToprakBridgeAnalyticsData> {
    const config = loadToprakConfig();
    const url = `${config.socialBaseUrl.replace(/\/$/, "")}/api/internal/toprak?action=analytics&slug=${encodeURIComponent(brandSlug)}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "x-toprak-bridge-key": config.bridgeSecret,
        },
        signal: AbortSignal.timeout(4500),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        analytics?: ToprakBridgeAnalyticsData;
        error?: string;
      };

      if (!res.ok || !data.ok || !data.analytics) {
        throw new Error(data.error || `Social HTTP ${res.status}`);
      }

      return data.analytics;
    } catch (err) {
      if (this.isNetworkOfflineError(err)) {
        return await getBrandPerformanceDataForToprak(brandSlug);
      }
      throw err;
    }
  }

  static async injectPendingApproval(
    input: ToprakBridgeInjectInput
  ): Promise<ToprakBridgeInjectResult> {
    const config = loadToprakConfig();
    const url = `${config.socialBaseUrl.replace(/\/$/, "")}/api/internal/toprak`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-toprak-bridge-key": config.bridgeSecret,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15000),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: ToprakBridgeInjectResult;
        error?: string;
      };

      if (!res.ok || !data.ok || !data.result) {
        throw new Error(data.error || `Social HTTP ${res.status}`);
      }

      return data.result;
    } catch (err) {
      if (this.isNetworkOfflineError(err)) {
        return await receiveToprakPackageAsPendingApproval(input);
      }
      throw err;
    }
  }
}
