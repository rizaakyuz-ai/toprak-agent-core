import fs from "node:fs";
import path from "node:path";
import { loadToprakConfig, TOPRAK_ROOT } from "./config";
import { BrandKnowledge } from "./types";

export type AgeGroupKey = "18_24" | "25_34" | "35_49" | "50_65";
export type StylingCategory = "STANDARD" | "TESETTUR";
export type CastSlotType = "FEMALE_STANDARD" | "FEMALE_TESETTUR" | "MALE";

export interface PersonaProfile {
  id: string;
  name: string;
  gender: "FEMALE" | "MALE";
  stylingCategory?: StylingCategory;
  ageGroup: AgeGroupKey;
  exactAge: number;
  ethnicity: string;
  hairColor: string;
  hairStyle: string;
  physicalBuild: string;
  distinguishingFeature: string;
  styleVibe: string;
  promptDescriptionEn: string;
}

export interface CastingPoolData {
  version: string;
  description: string;
  ageGroups: Array<{ key: string; label: string; minAge: number; maxAge: number }>;
  personas: PersonaProfile[];
}

export interface PersonaSelectOptions {
  genderPreference?: "FEMALE" | "MALE" | "ANY";
  stylingPreference?: StylingCategory | "ANY";
  ageGroupPreference?: AgeGroupKey | "ANY";
  brand?: BrandKnowledge;
  topic?: string;
  excludeId?: string;
}

interface BrandCastingRotationState {
  stepIndex: number;
  lastPersonaId: string | null;
  lastSlot: CastSlotType | null;
  lastAgeGroup: AgeGroupKey | null;
  recentAgeGroups: AgeGroupKey[];
  usedIdsInSlotRound: Record<CastSlotType, string[]>;
}

interface PersistentCastingState {
  version: number;
  updatedAt: string;
  globalLastPersonaId: string | null;
  globalUsageCounts: Record<string, number>;
  brands: Record<string, BrandCastingRotationState>;
}

const CASTING_POOL_PATH = path.join(TOPRAK_ROOT, "config", "casting_pool.json");

// Moda markaları (Modena vb.): 2 Kadın (Açık -> Tesettürlü) : 1 Erkek ritmi
// Kadın [Açık] -> Erkek -> Kadın [Tesettürlü] -> Kadın [Açık] -> Erkek -> Kadın [Tesettürlü]...
const FASHION_SLOT_CADENCE: CastSlotType[] = [
  "FEMALE_STANDARD",
  "MALE",
  "FEMALE_TESETTUR",
];

// Genel teknoloji / iş / finans markaları: 1 Kadın : 1 Erkek ritmi (Kadınlarda Açık <-> Tesettürlü çapraz)
// Kadın [Açık] -> Erkek -> Kadın [Tesettürlü] -> Erkek...
const GENERAL_SLOT_CADENCE: CastSlotType[] = [
  "FEMALE_STANDARD",
  "MALE",
  "FEMALE_TESETTUR",
  "MALE",
];

const YOUNG_AGE_GROUPS: AgeGroupKey[] = ["18_24", "25_34"];
const MATURE_AGE_GROUPS: AgeGroupKey[] = ["35_49", "50_65"];
const ALL_AGE_GROUPS: AgeGroupKey[] = ["18_24", "25_34", "35_49", "50_65"];

export class CastingManager {
  private static cachedData: CastingPoolData | null = null;

  private static getStateFilePath(): string {
    const dir = loadToprakConfig().storageDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, "casting_state.json");
  }

  private static loadPool(): CastingPoolData {
    if (this.cachedData) return this.cachedData;
    try {
      if (fs.existsSync(CASTING_POOL_PATH)) {
        const raw = fs.readFileSync(CASTING_POOL_PATH, "utf-8");
        this.cachedData = JSON.parse(raw) as CastingPoolData;
        return this.cachedData;
      }
    } catch (err) {
      console.warn("[CastingManager] casting_pool.json okunamadı:", err);
    }

    return {
      version: "2.0.0",
      description: "Fallback",
      ageGroups: [],
      personas: [
        {
          id: "default_sofia",
          name: "Sofia",
          gender: "FEMALE",
          stylingCategory: "STANDARD",
          ageGroup: "25_34",
          exactAge: 27,
          ethnicity: "Mediterranean",
          hairColor: "Dark Brown",
          hairStyle: "Sleek ponytail",
          physicalBuild: "174cm slender",
          distinguishingFeature: "Warm hazel eyes",
          styleVibe: "Quiet luxury",
          promptDescriptionEn:
            "A 27-year-old Mediterranean woman with dark hair, warm hazel eyes, wearing a beige tailored trench coat",
        },
      ],
    };
  }

  private static createEmptyBrandState(): BrandCastingRotationState {
    return {
      stepIndex: 0,
      lastPersonaId: null,
      lastSlot: null,
      lastAgeGroup: null,
      recentAgeGroups: [],
      usedIdsInSlotRound: {
        FEMALE_STANDARD: [],
        FEMALE_TESETTUR: [],
        MALE: [],
      },
    };
  }

  private static readState(): PersistentCastingState {
    const statePath = this.getStateFilePath();
    try {
      if (fs.existsSync(statePath)) {
        const parsed = JSON.parse(
          fs.readFileSync(statePath, "utf-8")
        ) as Partial<PersistentCastingState>;
        return {
          version: 1,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          globalLastPersonaId: parsed.globalLastPersonaId || null,
          globalUsageCounts: parsed.globalUsageCounts || {},
          brands: parsed.brands || {},
        };
      }
    } catch (err) {
      console.warn("[CastingManager] casting_state.json okunamadı, sıfırdan başlatılıyor:", err);
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      globalLastPersonaId: null,
      globalUsageCounts: {},
      brands: {},
    };
  }

  private static writeState(state: PersistentCastingState): void {
    const statePath = this.getStateFilePath();
    try {
      state.updatedAt = new Date().toISOString();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.warn("[CastingManager] casting_state.json yazılamadı:", err);
    }
  }

  static getPersonaSlot(persona: PersonaProfile): CastSlotType {
    if (persona.gender === "MALE") return "MALE";
    return persona.stylingCategory === "TESETTUR"
      ? "FEMALE_TESETTUR"
      : "FEMALE_STANDARD";
  }

  static isFashionBrand(brand?: BrandKnowledge): boolean {
    if (!brand) return false;
    if (brand.slug === "modena") return true;
    const text = `${brand.slug} ${brand.name} ${brand.sector}`.toLowerCase();
    return /moda|giyim|stil|kombin|gardırop|gardirop|fashion|apparel|wardrobe|stylist/.test(
      text
    );
  }

  private static inferTopicOverrides(topic?: string): {
    slotOverride?: CastSlotType;
    ageOverride?: AgeGroupKey;
  } {
    if (!topic) return {};
    const t = topic.toLowerCase();

    let slotOverride: CastSlotType | undefined;
    if (/(tesettür|tesettur|şal bağlama|sal baglama|eşarp|esarp|muhafazakar giyim|hijab)/i.test(t)) {
      slotOverride = "FEMALE_TESETTUR";
    } else if (/(erkek kombin|erkek stil|erkek giyim|damatlık|damatlik|centilmen)/i.test(t)) {
      slotOverride = "MALE";
    }

    let ageOverride: AgeGroupKey | undefined;
    if (/(üniversite|universite|kampüs|kampus|18-24|gen-z|gen z)/i.test(t)) {
      ageOverride = "18_24";
    } else if (/(50 yaş|60 yaş|olgun şıklık|emekli|ileri yaş)/i.test(t)) {
      ageOverride = "50_65";
    }

    return { slotOverride, ageOverride };
  }

  /**
   * Tüm dijital modelleri listeler.
   */
  static getAllPersonas(): PersonaProfile[] {
    return this.loadPool().personas;
  }

  /**
   * Cast havuzu istatistik özeti döndürür (Arayüz / API durum kutusu için).
   */
  static getPoolSummary(): {
    total: number;
    femaleStandard: number;
    femaleTesettur: number;
    male: number;
  } {
    const personas = this.getAllPersonas();
    return {
      total: personas.length,
      femaleStandard: personas.filter((p) => this.getPersonaSlot(p) === "FEMALE_STANDARD").length,
      femaleTesettur: personas.filter((p) => this.getPersonaSlot(p) === "FEMALE_TESETTUR").length,
      male: personas.filter((p) => this.getPersonaSlot(p) === "MALE").length,
    };
  }

  /**
   * Torba Kurrası + 3 Boyutlu Çapraz Rotasyon (Cinsiyet x Açık/Tesettür x Genç/Yaşlı) ile model seçer.
   * - Moda markalarında (Modena vb.): 2 Kadın (Açık -> Erkek -> Tesettürlü) : 1 Erkek ritmi uygular.
   * - Diğer markalarda: 1 Kadın : 1 Erkek (Açık -> Erkek -> Tesettürlü -> Erkek) ritmi uygular.
   * - Her adımda yaş kuşağını Genç (18-34) <-> Olgun/Yaşlı (35-65) çaprazlar.
   * - Aynı kategorideki tüm modeller torbadan 1 kez çekilmeden hiçbir model tekrar seçilmez.
   */
  static selectPersona(opts: PersonaSelectOptions = {}): PersonaProfile {
    const pool = this.loadPool();
    const allPersonas = pool.personas;
    const state = this.readState();

    const brandKey = opts.brand?.slug || "_global";
    if (!state.brands[brandKey]) {
      state.brands[brandKey] = this.createEmptyBrandState();
    }
    const bState = state.brands[brandKey];
    if (!bState.usedIdsInSlotRound) {
      bState.usedIdsInSlotRound = {
        FEMALE_STANDARD: [],
        FEMALE_TESETTUR: [],
        MALE: [],
      };
    }

    const topicHints = this.inferTopicOverrides(opts.topic);
    const cadence = this.isFashionBrand(opts.brand)
      ? FASHION_SLOT_CADENCE
      : GENERAL_SLOT_CADENCE;

    // 1. Hedef Slot Belirleme (Explicit -> Konu İpucu -> Marka Çapraz Ritmi)
    let targetSlot: CastSlotType;
    let advanceCadenceStep = false;

    if (opts.genderPreference === "MALE") {
      targetSlot = "MALE";
    } else if (opts.stylingPreference === "TESETTUR") {
      targetSlot = "FEMALE_TESETTUR";
    } else if (opts.stylingPreference === "STANDARD" && opts.genderPreference === "FEMALE") {
      targetSlot = "FEMALE_STANDARD";
    } else if (opts.genderPreference === "FEMALE") {
      targetSlot =
        bState.lastSlot === "FEMALE_STANDARD" ? "FEMALE_TESETTUR" : "FEMALE_STANDARD";
    } else if (topicHints.slotOverride) {
      targetSlot = topicHints.slotOverride;
    } else {
      targetSlot = cadence[bState.stepIndex % cadence.length];
      advanceCadenceStep = true;
    }

    // 2. İlgili Slottaki Modelleri Al ve Torba Kurrasını (Fair Bag) Uygula
    let slotCandidates = allPersonas.filter(
      (p) => this.getPersonaSlot(p) === targetSlot
    );
    if (slotCandidates.length === 0) {
      slotCandidates = [...allPersonas];
    }

    const usedInRound = new Set(bState.usedIdsInSlotRound[targetSlot] || []);
    let unpickedInRound = slotCandidates.filter((p) => !usedInRound.has(p.id));

    // Bu slottaki tüm modeller 1 tam tur kullanıldıysa torbayı yenile!
    if (unpickedInRound.length === 0) {
      bState.usedIdsInSlotRound[targetSlot] = [];
      unpickedInRound = [...slotCandidates];
    }

    // Üst üste aynı modelin gelmesini engelle (tur geçişi dahil)
    const avoidIds = new Set(
      [opts.excludeId, bState.lastPersonaId, state.globalLastPersonaId].filter(
        Boolean
      ) as string[]
    );
    if (unpickedInRound.length > 1) {
      const nonImmediate = unpickedInRound.filter((p) => !avoidIds.has(p.id));
      if (nonImmediate.length > 0) {
        unpickedInRound = nonImmediate;
      }
    }

    // 3. Çapraz Yaş Kuşağı Hedefi (Genç [18_24, 25_34] <-> Olgun/Yaşlı [35_49, 50_65])
    const explicitAge =
      opts.ageGroupPreference && opts.ageGroupPreference !== "ANY"
        ? opts.ageGroupPreference
        : topicHints.ageOverride;

    let preferredPole: AgeGroupKey[];
    if (explicitAge) {
      preferredPole = [explicitAge];
    } else if (bState.lastAgeGroup && YOUNG_AGE_GROUPS.includes(bState.lastAgeGroup)) {
      preferredPole = MATURE_AGE_GROUPS;
    } else if (bState.lastAgeGroup && MATURE_AGE_GROUPS.includes(bState.lastAgeGroup)) {
      preferredPole = YOUNG_AGE_GROUPS;
    } else {
      preferredPole = bState.stepIndex % 2 === 0 ? YOUNG_AGE_GROUPS : MATURE_AGE_GROUPS;
    }

    // En az yakın zamanda kullanılan spesifik yaş grubunu öne çıkar
    const recentAges = bState.recentAgeGroups || [];
    const ageFreshnessScore = (ag: AgeGroupKey): number => {
      const lastIdx = recentAges.lastIndexOf(ag);
      return lastIdx === -1 ? 50 : Math.max(0, (recentAges.length - 1 - lastIdx) * 12);
    };

    // 4. Torbadaki Adayları Puanla (Çapraz Yaş + Yaş Tazeliği + Global Az Kullanım + Kurra Şansı)
    const scored = unpickedInRound.map((persona) => {
      let score = 0;
      if (explicitAge && persona.ageGroup === explicitAge) {
        score += 200;
      } else if (preferredPole.includes(persona.ageGroup)) {
        score += 100;
      }
      score += ageFreshnessScore(persona.ageGroup);

      const globalCount = state.globalUsageCounts[persona.id] || 0;
      score -= globalCount * 6;

      // Eşit puanlı adaylar arasında gerçek kurra çekilişi
      score += Math.random() * 5;
      return { persona, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0].persona;

    // 5. Kalıcı Durumu Güncelle ve Kaydet
    if (advanceCadenceStep) {
      bState.stepIndex += 1;
    }
    bState.lastPersonaId = selected.id;
    bState.lastSlot = targetSlot;
    bState.lastAgeGroup = selected.ageGroup;
    bState.recentAgeGroups = [...recentAges, selected.ageGroup].slice(-ALL_AGE_GROUPS.length * 2);

    if (!bState.usedIdsInSlotRound[targetSlot].includes(selected.id)) {
      bState.usedIdsInSlotRound[targetSlot].push(selected.id);
    }

    state.globalLastPersonaId = selected.id;
    state.globalUsageCounts[selected.id] =
      (state.globalUsageCounts[selected.id] || 0) + 1;

    this.writeState(state);

    const slotLabel =
      targetSlot === "FEMALE_TESETTUR"
        ? "Kadın • Tesettür"
        : targetSlot === "FEMALE_STANDARD"
        ? "Kadın • Açık"
        : "Erkek";

    console.log(
      `[Toprak CastingManager] 🎭 Kurra & Çapraz Seçim (${brandKey}): ${selected.name} (${selected.exactAge} yaş, ${slotLabel}, Grup: ${selected.ageGroup}) [Torbada kullanılan: ${bState.usedIdsInSlotRound[targetSlot].length}/${slotCandidates.length}]`
    );

    return selected;
  }
}
