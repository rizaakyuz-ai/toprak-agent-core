import fs from "node:fs";
import path from "node:path";
import { CastSlotType } from "./casting-manager";
import { loadToprakConfig, TOPRAK_ROOT } from "./config";
import { BrandKnowledge } from "./types";

export type ScenarioCluster =
  | "ACTIVE_OUTDOOR"
  | "CELEBRATION_NIGHT"
  | "BUSINESS_TRAVEL"
  | "SMART_EXPERIENCE";

export interface ScenarioDefinition {
  id: string;
  cluster: ScenarioCluster;
  titleTr: string;
  copyFocusTr: string;
  matchKeywordsTr: string[];
  environmentEn: string;
  cameraAndMovementEn: string;
  lightingEn: string;
  actionChoreographyEn: string;
  wardrobeBySlotEn: Record<CastSlotType, string>;
}

interface ScenarioPoolsFile {
  version: string;
  description: string;
  brandPools: Record<string, ScenarioDefinition[]>;
}

interface BrandScenarioRotationState {
  stepIndex: number;
  lastScenarioId: string | null;
  lastCluster: ScenarioCluster | null;
  recentClusters: ScenarioCluster[];
  usedScenarioIdsInRound: string[];
  usageCounts: Record<string, number>;
}

interface PersistentScenarioState {
  version: number;
  updatedAt: string;
  brands: Record<string, BrandScenarioRotationState>;
}

const SCENARIO_POOLS_PATH = path.join(TOPRAK_ROOT, "config", "scenario_pools.json");

export class ScenarioManager {
  private static cachedPools: ScenarioPoolsFile | null = null;

  private static getStateFilePath(): string {
    const dir = loadToprakConfig().storageDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, "scenario_state.json");
  }

  private static loadPools(): ScenarioPoolsFile {
    if (this.cachedPools) return this.cachedPools;
    try {
      if (fs.existsSync(SCENARIO_POOLS_PATH)) {
        const raw = fs.readFileSync(SCENARIO_POOLS_PATH, "utf-8");
        this.cachedPools = JSON.parse(raw) as ScenarioPoolsFile;
        return this.cachedPools;
      }
    } catch (err) {
      console.warn("[ScenarioManager] scenario_pools.json okunamadı:", err);
    }
    return {
      version: "1.0.0",
      description: "Empty fallback",
      brandPools: {},
    };
  }

  private static createEmptyBrandState(): BrandScenarioRotationState {
    return {
      stepIndex: 0,
      lastScenarioId: null,
      lastCluster: null,
      recentClusters: [],
      usedScenarioIdsInRound: [],
      usageCounts: {},
    };
  }

  private static readState(): PersistentScenarioState {
    const statePath = this.getStateFilePath();
    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(
          fs.readFileSync(statePath, "utf-8")
        ) as Partial<PersistentScenarioState>;
        return {
          version: 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          brands: parsed.brands || {},
        };
      }
    } catch (err) {
      console.warn("[ScenarioManager] scenario_state.json okunamadı, sıfırdan başlatılıyor:", err);
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      brands: {},
    };
  }

  private static writeState(state: PersistentScenarioState): void {
    const statePath = this.getStateFilePath();
    try {
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.warn("[ScenarioManager] scenario_state.json yazılamadı:", err);
    }
  }

  static getScenariosForBrand(brandSlug: string): ScenarioDefinition[] {
    const pools = this.loadPools();
    return pools.brandPools[brandSlug] || [];
  }

  /**
   * Kullanıcının girdiği özel konu metninden (veya tıkladığı trend kartından) eşleşen senaryoyu bulur.
   * Eşleşme bulursa rotasyon hafızasına da işler ki bir sonraki otonom üretim farklı kümeden seçilsin.
   */
  static matchScenarioFromTopic(
    brand: Pick<BrandKnowledge, "slug" | "name">,
    topicText?: string,
    recordUsage = true
  ): ScenarioDefinition | undefined {
    if (!topicText || !topicText.trim()) return undefined;
    const pool = this.getScenariosForBrand(brand.slug);
    if (pool.length === 0) return undefined;

    const normalized = topicText.toLocaleLowerCase("tr-TR");
    let bestMatch: { scenario: ScenarioDefinition; hits: number } | undefined;

    for (const sc of pool) {
      let hits = 0;
      for (const kw of sc.matchKeywordsTr) {
        const kwNorm = kw.toLocaleLowerCase("tr-TR");
        if (normalized.includes(kwNorm)) {
          hits += kwNorm.includes(" ") ? 2 : 1;
        }
      }
      if (hits > 0 && (!bestMatch || hits > bestMatch.hits)) {
        bestMatch = { scenario: sc, hits };
      }
    }

    if (bestMatch && recordUsage) {
      this.recordScenarioSelection(brand.slug, bestMatch.scenario);
      console.log(
        `[Toprak ScenarioManager] 🎯 Özel Konu Senaryoyla Eşleşti (${brand.slug}): ${bestMatch.scenario.titleTr} [${bestMatch.scenario.cluster}]`
      );
    }

    return bestMatch?.scenario;
  }

  private static recordScenarioSelection(
    brandSlug: string,
    selected: ScenarioDefinition
  ): void {
    const state = this.readState();
    if (!state.brands[brandSlug]) {
      state.brands[brandSlug] = this.createEmptyBrandState();
    }
    const bState = state.brands[brandSlug];
    bState.stepIndex += 1;
    bState.lastScenarioId = selected.id;
    bState.lastCluster = selected.cluster;
    bState.recentClusters = [...(bState.recentClusters || []), selected.cluster].slice(-8);
    if (!bState.usedScenarioIdsInRound.includes(selected.id)) {
      bState.usedScenarioIdsInRound.push(selected.id);
    }
    bState.usageCounts[selected.id] = (bState.usageCounts[selected.id] || 0) + 1;
    this.writeState(state);
  }

  /**
   * Otonom üretim için Torba Kurrası + Küme Çaprazlaması (Cross-Cluster Alternation) ile
   * sıradaki yaşam anı / etkinlik senaryosunu seçer.
   * - Tüm senaryolar 1 turda kullanılmadan hiçbir senaryo 2. kez seçilmez.
   * - Ardışık iki içerik asla aynı kümeden (örn. üst üste iki iç mekan veya iki gece daveti) gelmez.
   */
  static selectNextScenario(
    brand: Pick<BrandKnowledge, "slug" | "name">
  ): ScenarioDefinition | undefined {
    const pool = this.getScenariosForBrand(brand.slug);
    if (pool.length === 0) return undefined;

    const state = this.readState();
    if (!state.brands[brand.slug]) {
      state.brands[brand.slug] = this.createEmptyBrandState();
    }
    const bState = state.brands[brand.slug];

    const usedSet = new Set(bState.usedScenarioIdsInRound || []);
    let unpicked = pool.filter((s) => !usedSet.has(s.id));

    // Torbadaki tüm senaryolar (örn. 8/8) tamamlandıysa yeni tura başla!
    if (unpicked.length === 0) {
      bState.usedScenarioIdsInRound = [];
      unpicked = [...pool];
    }

    // Tur geçişinde dahi bir önceki senaryonun aynısını seçme
    if (bState.lastScenarioId && unpicked.length > 1) {
      const filtered = unpicked.filter((s) => s.id !== bState.lastScenarioId);
      if (filtered.length > 0) unpicked = filtered;
    }

    const recentClusters = bState.recentClusters || [];
    const clusterFreshness = (cluster: ScenarioCluster): number => {
      const lastIdx = recentClusters.lastIndexOf(cluster);
      return lastIdx === -1 ? 60 : Math.max(0, (recentClusters.length - 1 - lastIdx) * 18);
    };

    const scored = unpicked.map((scenario) => {
      let score = 0;

      // 1. Kesin Çapraz Küme Kuralı: Bir önceki kümeden farklı olanlara güçlü öncelik
      if (!bState.lastCluster || scenario.cluster !== bState.lastCluster) {
        score += 120;
      }

      // 2. Uzun süredir gelmeyen kümeye ek tazelik puanı
      score += clusterFreshness(scenario.cluster);

      // 3. Başlangıçta dış mekan / aktif ve etkinlik senaryolarını iç mekana göre bir adım önde başlat
      if (bState.stepIndex === 0 && scenario.cluster !== "SMART_EXPERIENCE") {
        score += 15;
      }

      // 4. Toplam kullanım dengesi + adil kurra şansı
      const totalUsed = bState.usageCounts[scenario.id] || 0;
      score -= totalUsed * 8;
      score += Math.random() * 6;

      return { scenario, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0].scenario;

    // Durumu kalıcı olarak kaydet
    bState.stepIndex += 1;
    bState.lastScenarioId = selected.id;
    bState.lastCluster = selected.cluster;
    bState.recentClusters = [...recentClusters, selected.cluster].slice(-8);
    if (!bState.usedScenarioIdsInRound.includes(selected.id)) {
      bState.usedScenarioIdsInRound.push(selected.id);
    }
    bState.usageCounts[selected.id] = (bState.usageCounts[selected.id] || 0) + 1;
    this.writeState(state);

    console.log(
      `[Toprak ScenarioManager] 🎬 Senaryo Kurrası (${brand.slug}): ${selected.titleTr} [Küme: ${selected.cluster}] (Tur: ${bState.usedScenarioIdsInRound.length}/${pool.length})`
    );

    return selected;
  }

  /**
   * 'AI Trendleri Tara' butonu gibi çoklu fikir önizlemeleri için torbayı tüketmeden
   * birbirinden farklı kümelerden N adet çeşitli senaryo döndürür.
   */
  static peekDistinctScenarios(
    brandOrSlug: string | Pick<BrandKnowledge, "slug">,
    count: number
  ): ScenarioDefinition[] {
    const brandSlug = typeof brandOrSlug === "string" ? brandOrSlug : brandOrSlug.slug;
    const pool = this.getScenariosForBrand(brandSlug);
    if (pool.length === 0 || count <= 0) return [];

    const state = this.readState();
    const bState = state.brands[brandSlug] || this.createEmptyBrandState();
    const usedSet = new Set(bState.usedScenarioIdsInRound || []);

    const prioritized = [
      ...pool.filter((s) => !usedSet.has(s.id)),
      ...pool.filter((s) => usedSet.has(s.id)),
    ];

    const picked: ScenarioDefinition[] = [];
    const seenClusters = new Set<ScenarioCluster>();

    // Önce farklı kümelerden birer tane al
    for (const sc of prioritized) {
      if (picked.length >= count) break;
      if (!seenClusters.has(sc.cluster) && sc.cluster !== bState.lastCluster) {
        picked.push(sc);
        seenClusters.add(sc.cluster);
      }
    }
    for (const sc of prioritized) {
      if (picked.length >= count) break;
      if (!picked.some((p) => p.id === sc.id) && !seenClusters.has(sc.cluster)) {
        picked.push(sc);
        seenClusters.add(sc.cluster);
      }
    }
    for (const sc of prioritized) {
      if (picked.length >= count) break;
      if (!picked.some((p) => p.id === sc.id)) {
        picked.push(sc);
      }
    }

    return picked;
  }
}
