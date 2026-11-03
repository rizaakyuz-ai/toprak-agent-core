import { ToprakAiHub } from "../core/ai-hub";
import {
  BrandKnowledge,
  BrandProfile,
  ProductionPrompts,
  ProductionPromptsSchema,
  ToprakPlatform,
} from "../core/types";
import { BrandKnowledgeStore } from "../core/brand-knowledge-store";
import { CastingManager, PersonaProfile } from "../core/casting-manager";
import { LearningEngine } from "../core/learning-engine";
import { ScenarioDefinition, ScenarioManager } from "../core/scenario-manager";

export interface DesignPromptsOptions {
  brand: BrandProfile | BrandKnowledge | string;
  topic: string;
  headline: string;
  hookText?: string;
  scriptSnippet?: string;
  targetPlatform?: ToprakPlatform;
  formatType?: "VERTICAL_VIDEO" | "EDITORIAL_POSTER" | "CAROUSEL_SERIES";
  personaOverride?: PersonaProfile;
  scenario?: ScenarioDefinition;
}

export class PromptArchitect {
  private static normalizeBrand(brandInput: BrandProfile | BrandKnowledge | string): BrandKnowledge {
    if (typeof brandInput === "string") {
      const cached = BrandKnowledgeStore.getBrand(brandInput);
      if (!cached) {
        throw new Error(`[PromptArchitect] '${brandInput}' markası hafızada bulunamadı!`);
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
   * 5 KİŞİLİK YAPAY ZEKA PRODÜKSİYON VE PROMPT MÜHENDİSLİĞİ KONSEYİ.
   * Cast Ajansı (CastingManager) üzerinden hedef kitleye uygun model seçer,
   * markanın KENDİ sektörüne göre (moda, teknoloji, kariyer, rüya/psikoloji, finans vb.) sahne ve ışık kurar.
   */
  static async designPrompts(opts: DesignPromptsOptions): Promise<ProductionPrompts> {
    const brand = this.normalizeBrand(opts.brand);
    const wisdom = LearningEngine.getWisdomForBrand(brand.slug);

    const selectedPersona =
      opts.personaOverride ||
      CastingManager.selectPersona({
        brand,
        topic: opts.topic,
      });

    const targetAspectRatio =
      opts.formatType === "EDITORIAL_POSTER" ? "4:5" : "9:16";

    const isTesettur = selectedPersona.stylingCategory === "TESETTUR";
    const activeScenario =
      opts.scenario ||
      ScenarioManager.matchScenarioFromTopic(brand, opts.topic, false);
    const slotKey = CastingManager.getPersonaSlot(selectedPersona);
    const scenarioWardrobe = activeScenario?.wardrobeBySlotEn?.[slotKey];

    console.log(`[Toprak PromptArchitect] 🎨 5'li AI Prodüksiyon Konseyi Toplandı: ${brand.name} (${brand.sector})`);
    console.log(
      `[Toprak PromptArchitect] 👤 Cast Ajansı Seçimi: ${selectedPersona.name} (${selectedPersona.exactAge} yaş, ${selectedPersona.ethnicity}${isTesettur ? ", Tesettür Stil" : ""})${activeScenario ? ` | 🎬 Senaryo: ${activeScenario.titleTr}` : ""}`
    );

    const hairOrHeadscarfLine = isTesettur
      ? `- Modest Hijab & Build: ${selectedPersona.hairStyle} (${selectedPersona.hairColor}), ${selectedPersona.physicalBuild}\n- MANDATORY MODESTY / HIJAB DIRECTIVE: ${selectedPersona.name} wears a chic, culturally authentic modern Turkish hijab/headscarf gracefully covering ALL hair and neck (strictly ZERO exposed hair strands), paired with refined, contemporary modest long-sleeve attire appropriate for "${brand.sector}".`
      : `- Hair & Build: ${selectedPersona.hairColor}, ${selectedPersona.hairStyle}, ${selectedPersona.physicalBuild}`;

    const negativeModestSuffix = isTesettur
      ? ", exposed hair strands, uncovered hair, sheer or revealing clothing"
      : "";

    const scenarioDirectiveEn = activeScenario
      ? `
REAL-LIFE OCCASION & PHYSICAL ACTION CHOREOGRAPHY (MANDATORY — DO NOT USE A BEDROOM/WARDROBE SETTING UNLESS SPECIFIED BELOW):
- Occasion / Activity: ${activeScenario.titleTr} (${activeScenario.cluster})
- Mandatory Environment / Location: ${activeScenario.environmentEn}
- Mandatory Camera Rig & Movement: ${activeScenario.cameraAndMovementEn}
- Mandatory Lighting: ${activeScenario.lightingEn}
- Mandatory Physical Action in Video: ${activeScenario.actionChoreographyEn}
- Mandatory Tailored Wardrobe for ${selectedPersona.name} (${slotKey}): ${scenarioWardrobe || selectedPersona.styleVibe}
(CRITICAL: Show ${selectedPersona.name} PHYSICALLY PERFORMING this real-life activity in this exact environment — e.g., actively jogging/walking outdoors if Sport, walking into the illuminated venue if Wedding/Birthday, striding through the corporate plaza if Office!)`
      : "";

    const systemInstruction = `You are a world-class Commercial Director of Photography (DoP), Production Designer, and Senior Generative AI Prompt Engineer.
Your job is to craft sector-authentic, photorealistic English prompts for video, photography, character consistency, and audio tailored STRICTLY to the brand's actual industry and tone.

BRAND CONTEXT (MANDATORY — ADAPT ALL ENVIRONMENT, WARDROBE & MUSIC TO THIS SECTOR):
- Brand Name: ${brand.name}
- Industry / Sector: ${brand.sector}
- Brand Colors: Primary ${brand.primaryColor}, Accent ${brand.accentColor}
- Tone of Voice: ${brand.toneOfVoice}
- Target Audience: ${brand.targetAudience}
- Learning Engine Visual Guidance: ${wisdom.councilDirectives.promptArchitectGuidance}

CASTED TALENT FROM CASTING AGENCY (MANDATORY):
- Name: ${selectedPersona.name}
- Age & Gender: ${selectedPersona.exactAge}yo, ${selectedPersona.gender}${isTesettur ? " (Modest Hijabi / Tesettür Styling)" : ""}
- Ethnicity: ${selectedPersona.ethnicity}
${hairOrHeadscarfLine}
- Distinguishing Feature: ${selectedPersona.distinguishingFeature}
- Base Visual Anchor: "${selectedPersona.promptDescriptionEn}"
(IMPORTANT: Adapt ${selectedPersona.name}'s wardrobe and setting so it fits "${brand.sector}" naturally${isTesettur ? " while strictly preserving full hijab hair/neck coverage and modern modest elegance" : " — do NOT use fashion/trench-coat tropes unless the brand is actually in the fashion sector"}!)${scenarioDirectiveEn}

CRITICAL RULES:
1. Video Master Prompt (90-130 words in English): Specify subject (${selectedPersona.name}), exact occasion environment, dynamic camera rig & lens, natural volumetric lighting, authentic 10-second physical action choreography (not a static pose!), and photorealistic physics.
2. Photo Master Prompt (70-100 words in English): Vertical ${targetAspectRatio} commercial composition in the same real-life occasion environment with clean upper/lower negative space for typography, realistic skin texture, and zero text/watermarks inside the generated image.
3. Respond ONLY with valid JSON matching the exact schema below:
{
  "videoPrompt": {
    "masterPromptEn": "...",
    "cameraMovement": "...",
    "lensAndAperture": "...",
    "lightingAndAtmosphere": "...",
    "actionChoreography": "...",
    "aspectRatio": "9:16",
    "durationSec": 10,
    "fps": 24,
    "negativePrompt": "blurry, low resolution, 3d render, cartoon, plastic skin, distorted fingers, extra limbs, mutated anatomy, flickering, watermark, embedded text, gibberish letters${negativeModestSuffix}",
    "klingMotionTag": "[Camera: Slow Push In, Subject Motion: Natural]"
  },
  "photoPrompt": {
    "masterPromptEn": "...",
    "composition": "Vertical ${targetAspectRatio} framing, rule of thirds, clean negative space for headline overlay",
    "lighting": "...",
    "aspectRatio": "${targetAspectRatio}",
    "negativePrompt": "deformed, blurry, watermark, extra limbs, plastic skin, cartoon, embedded text, logos${negativeModestSuffix}",
    "midjourneyFlags": "--ar ${targetAspectRatio} --v 6.1 --style raw --stylize 180",
    "fluxPromptEn": "..."
  },
  "characterConsistency": {
    "modelDescriptionEn": "...",
    "wardrobeStylingEn": "...",
    "ethnicAesthetic": "${selectedPersona.ethnicity}",
    "approximateAge": ${selectedPersona.exactAge}
  },
  "voiceAndAudioPrompt": {
    "voiceGender": "${selectedPersona.gender === "FEMALE" ? "Female" : "Male"}",
    "toneAndVibe": "...",
    "elevenLabsStability": 0.65,
    "elevenLabsClarity": 0.85,
    "sunoMusicPromptEn": "...",
    "sunoBpm": 100
  }
}`;

    const promptText = `CAMPAIGN BRIEF FOR ${brand.name.toUpperCase()} (${brand.sector}):
- Topic: "${opts.topic}"
- Headline: "${opts.headline}"
${opts.hookText ? `- Hook: "${opts.hookText}"` : ""}
${opts.scriptSnippet ? `- Voiceover / Script Excerpt: "${opts.scriptSnippet.slice(0, 350)}"` : ""}
${opts.targetPlatform ? `- Primary Platform: ${opts.targetPlatform}` : ""}

Generate the sector-authentic JSON production prompt specification now.`;

    try {
      const res = await ToprakAiHub.dispatch({
        agentRole: "PROMPT_ARCHITECT",
        systemInstruction,
        prompt: promptText,
        jsonMode: true,
      });

      console.log(
        `[Toprak PromptArchitect] ✅ Model yanıtladı: ${res.provider}/${res.modelUsed} (${res.durationMs}ms)`
      );
      const parsed = JSON.parse(res.text);
      return ProductionPromptsSchema.parse(parsed);
    } catch (err) {
      console.warn(
        `[Toprak PromptArchitect] LLM çağrısı başarısız, marka ve cast uyumlu deterministik şablon kullanılıyor:`,
        err
      );
      return this.buildSectorNeutralPrompts(
        brand,
        selectedPersona,
        opts,
        targetAspectRatio,
        activeScenario
      );
    }
  }

  public static buildSectorNeutralPrompts(
    brand: BrandKnowledge,
    persona: PersonaProfile,
    opts: DesignPromptsOptions,
    aspectRatio: string,
    scenario?: ScenarioDefinition
  ): ProductionPrompts {
    const isTesettur = persona.stylingCategory === "TESETTUR";
    const slotKey = CastingManager.getPersonaSlot(persona);
    const scenarioWardrobe = scenario?.wardrobeBySlotEn?.[slotKey];

    const subjectStyling = isTesettur
      ? `wearing ${persona.hairStyle.toLowerCase()} with complete hair and neck coverage (zero exposed hair) and ${scenarioWardrobe || `chic contemporary modest long-sleeve attire appropriate for ${brand.sector}`}`
      : `with ${persona.hairColor.toLowerCase()} ${persona.hairStyle.toLowerCase()}, dressed in ${scenarioWardrobe || `contemporary attire appropriate for ${brand.sector}`}`;
    const negExtra = isTesettur
      ? ", exposed hair strands, uncovered hair, revealing clothing"
      : "";

    const envSetting = scenario?.environmentEn
      ? `${scenario.environmentEn} with subtle brand accents (${brand.primaryColor})`
      : `Authentic architectural environment reflecting "${opts.topic}" with subtle color accents (${brand.primaryColor})`;
    const camMove =
      scenario?.cameraAndMovementEn ||
      "Fluid 3-axis gimbal slow push-in from medium shot to close portrait";
    const lightAtmos =
      scenario?.lightingEn ||
      "Soft natural volumetric daylight with balanced contrast";
    const physicalAction = scenario?.actionChoreographyEn
      ? `${persona.name} ${scenario.actionChoreographyEn.charAt(0).toLowerCase()}${scenario.actionChoreographyEn.slice(1)}`
      : `${persona.name} engages naturally with the scene and looks calmly toward the lens with confident expression`;

    return {
      videoPrompt: {
        masterPromptEn: `Cinematic 9:16 vertical commercial film for ${brand.name} in the ${brand.sector} sector. Subject: ${persona.name}, a ${persona.exactAge}-year-old ${persona.ethnicity} ${persona.gender.toLowerCase()} ${subjectStyling}, ${persona.distinguishingFeature.toLowerCase()}. Setting: ${envSetting}. Action: ${physicalAction}. Camera: ${camMove}, 35mm prime lens at f/1.8, shallow depth of field, ${lightAtmos}, photorealistic skin texture, 24fps, 8k resolution, zero embedded text.`,
        cameraMovement: camMove,
        lensAndAperture: "35mm prime lens, f/1.8 shallow depth of field",
        lightingAndAtmosphere: lightAtmos,
        actionChoreography: physicalAction,
        aspectRatio: "9:16",
        durationSec: 10,
        fps: 24,
        negativePrompt:
          `blurry, low resolution, cartoon, 3d render, plastic skin, distorted fingers, extra limbs, jittery motion, watermark, text${negExtra}`,
        klingMotionTag: scenario
          ? `[Camera: Dynamic Tracking, Subject Motion: ${scenario.cluster}]`
          : "[Camera: Slow Push In, Subject Motion: Natural]",
      },
      photoPrompt: {
        masterPromptEn: `High-end vertical ${aspectRatio} editorial photograph for ${brand.name} (${brand.sector}). Featuring ${persona.name}, ${persona.exactAge}-year-old ${persona.ethnicity} ${persona.gender.toLowerCase()} ${subjectStyling}, captured in ${envSetting}. Action & Pose: ${physicalAction}. Shot on medium format 85mm f/2.0 lens, ${lightAtmos}, subtle ${brand.accentColor} rim accent, clean negative space for typography, photorealistic, 8k resolution, no text.`,
        composition: `Vertical ${aspectRatio} portrait, rule of thirds, clean negative space for typography`,
        lighting: lightAtmos,
        aspectRatio,
        negativePrompt: `blurry, low quality, deformed, watermark, embedded text, logos${negExtra}`,
        midjourneyFlags: `--ar ${aspectRatio} --v 6.1 --style raw --stylize 160`,
        fluxPromptEn: `Editorial commercial portrait for ${brand.name} (${brand.sector}) featuring ${persona.name} (${subjectStyling}) in ${envSetting}, ${lightAtmos}, 8k`,
      },
      characterConsistency: {
        modelDescriptionEn: `${persona.exactAge}-year-old ${persona.ethnicity} ${persona.gender.toLowerCase()}, ${persona.hairColor}, ${persona.hairStyle}, ${persona.distinguishingFeature}`,
        wardrobeStylingEn:
          scenarioWardrobe ||
          (isTesettur
            ? `Modern Turkish modest hijabi styling with full hair coverage aligned with ${brand.sector}`
            : `Contemporary styling aligned with ${brand.sector}`),
        ethnicAesthetic: persona.ethnicity,
        approximateAge: persona.exactAge,
      },
      voiceAndAudioPrompt: {
        voiceGender: persona.gender === "FEMALE" ? "Female" : "Male",
        toneAndVibe: "Clear, warm, articulate and trustworthy brand voice",
        elevenLabsStability: 0.68,
        elevenLabsClarity: 0.85,
        sunoMusicPromptEn: `100 BPM modern atmospheric background rhythm tailored to ${brand.sector}`,
        sunoBpm: 100,
      },
    };
  }
}
