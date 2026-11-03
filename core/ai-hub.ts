import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { loadToprakConfig } from "./config";
import type { TranscriptResult, WordTimestamp } from "./types";

export type ToprakAgentRole =
  | "TREND_AGENT"
  | "COPYWRITER_AGENT"
  | "VALIDATOR_AGENT"
  | "PROMPT_ARCHITECT"
  | "BRAND_ANALYST"
  | "LEARNING_ENGINE";

export interface AiModelSpec {
  modelId: string;
  provider: "groq" | "gemini" | "openai";
  temperature: number;
  timeoutMs?: number;
  useWebSearch?: boolean;
  description: string;
}

export interface AiHubDispatchRequest {
  agentRole: ToprakAgentRole;
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  temperatureOverride?: number;
  preferredModelOverride?: string;
}

export interface AiHubDispatchResponse {
  text: string;
  modelUsed: string;
  provider: "groq" | "gemini" | "openai";
  durationMs: number;
}

export interface AiHubImageResponse {
  buffer: Buffer;
  modelUsed: string;
  provider: "gemini";
  durationMs: number;
}

export interface AiHubSpeechResponse {
  audioBuffer: Buffer;
  mimeType: string;
  modelUsed: string;
  provider: "gemini";
  durationMs: number;
}

// ==========================================
// 1. MERKEZİ AJAN-MODEL EŞLEME MATRİSİ (HUB)
// ==========================================
// Hangi ajanın hangi sağlayıcı ve modeli kullanacağı tek merkezde tarif edilmiştir.
// ÖNEMLİ KURAL: Yazar (COPYWRITER_AGENT) ile Denetçi (VALIDATOR_AGENT) farklı model ailesini
// birincil olarak kullanır; böylece "kendi yazdığını onaylama körlüğü" (self-bias) engellenir.
export const AGENT_MODEL_ROUTING: Record<ToprakAgentRole, AiModelSpec[]> = {
  TREND_AGENT: [
    {
      modelId: "gemini-2.5-flash",
      provider: "gemini",
      temperature: 0.65,
      timeoutMs: 25000,
      useWebSearch: true,
      description: "Google Search destekli güncel trend ve sektör araştırmacısı",
    },
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.7,
      timeoutMs: 30000,
      description: "Pazar açığı ve tüketici çelişkisi madenciliği için 120B ana model",
    },
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.65,
      timeoutMs: 25000,
      description: "Hızlı pazar analizi yedeği (Qwen 3.8)",
    },
    {
      modelId: "gpt-4o-mini",
      provider: "openai",
      temperature: 0.7,
      timeoutMs: 25000,
      description: "OpenAI trend analizi yedeği",
    },
  ],

  COPYWRITER_AGENT: [
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.7,
      timeoutMs: 45000,
      description: "Zengin Türkçe metin, sinematografik senaryo ve çoklu platform yazarı",
    },
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.65,
      timeoutMs: 35000,
      description: "Yaratıcı çoklu platform metin yazarı yedeği",
    },
    {
      modelId: "openai/gpt-oss-20b",
      provider: "groq",
      temperature: 0.6,
      timeoutMs: 25000,
      description: "Hızlı editoryal metin yazarı yedeği",
    },
    {
      modelId: "gemini-2.5-flash",
      provider: "gemini",
      temperature: 0.7,
      timeoutMs: 30000,
      description: "Gemini yaratıcı metin yedeği",
    },
    {
      modelId: "gpt-4o-mini",
      provider: "openai",
      temperature: 0.7,
      timeoutMs: 30000,
      description: "OpenAI yaratıcı yedek",
    },
  ],

  VALIDATOR_AGENT: [
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.1,
      timeoutMs: 30000,
      description: "Bağımsız model ailesi (Qwen) ile tarafsız kalite ve marka denetçisi",
    },
    {
      modelId: "openai/gpt-oss-20b",
      provider: "groq",
      temperature: 0.1,
      timeoutMs: 25000,
      description: "Hızlı kurumsal denetim yedeği",
    },
    {
      modelId: "gemini-2.5-flash",
      provider: "gemini",
      temperature: 0.1,
      timeoutMs: 25000,
      description: "Gemini katı denetim yedeği",
    },
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.1,
      timeoutMs: 30000,
      description: "Son kademe derin denetim yedeği",
    },
  ],

  PROMPT_ARCHITECT: [
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.6,
      timeoutMs: 30000,
      description: "Sinematografik İngilizce video/fotoğraf/ses prompt mimarı",
    },
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.55,
      timeoutMs: 25000,
      description: "Görsel ve video prompt mühendisi yedeği",
    },
    {
      modelId: "openai/gpt-oss-20b",
      provider: "groq",
      temperature: 0.5,
      timeoutMs: 20000,
      description: "Hızlı prompt mühendisi yedeği",
    },
  ],

  BRAND_ANALYST: [
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.2,
      timeoutMs: 30000,
      description: "Web sayfası metninden yapılandırılmış Marka DNA çıkarıcı",
    },
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.2,
      timeoutMs: 30000,
      description: "Derin kurumsal marka stratejisi çıkarıcı yedeği",
    },
    {
      modelId: "gemini-2.5-flash",
      provider: "gemini",
      temperature: 0.2,
      timeoutMs: 25000,
      description: "Gemini marka analisti yedeği",
    },
  ],

  LEARNING_ENGINE: [
    {
      modelId: "qwen/qwen3.8-27b",
      provider: "groq",
      temperature: 0.25,
      timeoutMs: 25000,
      description: "Gerçek paylaşım metriklerinden örüntü ve ajan tavsiyesi sentezleyici",
    },
    {
      modelId: "openai/gpt-oss-120b",
      provider: "groq",
      temperature: 0.25,
      timeoutMs: 25000,
      description: "Derin analitik bilgelik sentezleyici yedeği",
    },
    {
      modelId: "openai/gpt-oss-20b",
      provider: "groq",
      temperature: 0.2,
      timeoutMs: 20000,
      description: "Hızlı istatistik özetleyici yedeği",
    },
  ],
};

export const AUDIO_TRANSCRIPTION_MODELS = [
  { modelId: "whisper-large-v3", provider: "groq" as const },
  { modelId: "whisper-large-v3-turbo", provider: "groq" as const },
  { modelId: "gemini-2.5-flash", provider: "gemini" as const },
];

export const IMAGE_GENERATION_MODELS = [
  { modelId: "gemini-nano-banana-2.1", provider: "gemini" as const, api: "interactions" as const },
  { modelId: "gemini-3.1-flash-lite-image", provider: "gemini" as const, api: "interactions" as const },
  { modelId: "gemini-2.5-flash-image", provider: "gemini" as const, api: "generateContent" as const },
];

export const SPEECH_SYNTHESIS_MODELS = [
  { modelId: "gemini-3.8-flash-tts", provider: "gemini" as const },
  { modelId: "gemini-3.8-flash-lite-tts", provider: "gemini" as const },
];

export class ToprakAiHub {
  private static lastCallTimes: Map<string, number> = new Map();

  static getRoutingTableSummary() {
    return {
      agents: AGENT_MODEL_ROUTING,
      audioTranscription: AUDIO_TRANSCRIPTION_MODELS,
      imageGeneration: IMAGE_GENERATION_MODELS,
      speechSynthesis: SPEECH_SYNTHESIS_MODELS,
    };
  }

  /**
   * JSON yanıtlarında olası ```json ... ``` sarmalayıcılarını veya düşünme (<think>...</think>) bloklarını temizler.
   */
  static cleanJsonText(raw: string): string {
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) {
      cleaned = fenceMatch[1].trim();
    }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return cleaned.slice(firstBrace, lastBrace + 1);
    }
    return cleaned;
  }

  /**
   * Tüm LLM metin/JSON istekleri için TEK MERKEZİ DAĞITICI.
   */
  static async dispatch(req: AiHubDispatchRequest): Promise<AiHubDispatchResponse> {
    const config = loadToprakConfig();
    const candidateModels: AiModelSpec[] = req.preferredModelOverride
      ? [
          {
            modelId: req.preferredModelOverride,
            provider: req.preferredModelOverride.startsWith("gemini")
              ? "gemini"
              : req.preferredModelOverride.startsWith("gpt-")
              ? "openai"
              : "groq",
            temperature: req.temperatureOverride ?? 0.7,
            timeoutMs: 30000,
            description: "Özel seçilmiş model",
          },
        ]
      : AGENT_MODEL_ROUTING[req.agentRole] || AGENT_MODEL_ROUTING.COPYWRITER_AGENT;

    const startTime = Date.now();
    const errors: string[] = [];

    for (const spec of candidateModels) {
      const effectiveSpec: AiModelSpec =
        req.temperatureOverride !== undefined
          ? { ...spec, temperature: req.temperatureOverride }
          : spec;

      try {
        await this.applyRateLimitGuard(effectiveSpec.provider, effectiveSpec.modelId);

        let resultText = "";

        if (effectiveSpec.provider === "groq") {
          if (!config.groqApiKey) {
            errors.push(`${effectiveSpec.modelId}: GROQ_API_KEY tanımlı değil.`);
            continue;
          }
          resultText = await this.callGroq(effectiveSpec, config.groqApiKey, req);
        } else if (effectiveSpec.provider === "gemini") {
          if (!config.geminiApiKey) {
            errors.push(`${effectiveSpec.modelId}: GEMINI_API_KEY tanımlı değil.`);
            continue;
          }
          resultText = await this.callGeminiSdk(effectiveSpec, config.geminiApiKey, req);
        } else if (effectiveSpec.provider === "openai") {
          if (!config.openAiApiKey) {
            errors.push(`${effectiveSpec.modelId}: OPENAI_API_KEY tanımlı değil.`);
            continue;
          }
          resultText = await this.callOpenAi(effectiveSpec, config.openAiApiKey, req);
        }

        if (resultText && resultText.trim().length > 0) {
          const finalOutput = req.jsonMode ? this.cleanJsonText(resultText) : resultText;
          if (req.jsonMode) {
            // Geçerli JSON olduğundan emin ol; değilse sıradaki modele düş
            JSON.parse(finalOutput);
          }

          return {
            text: finalOutput,
            modelUsed: effectiveSpec.modelId,
            provider: effectiveSpec.provider,
            durationMs: Date.now() - startTime,
          };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Toprak AI Hub] (${req.agentRole}) ${effectiveSpec.provider}/${effectiveSpec.modelId} atlandı: ${msg.slice(0, 140)}`
        );
        errors.push(`${effectiveSpec.modelId} (${effectiveSpec.provider}): ${msg}`);
      }
    }

    throw new Error(
      `[Toprak AI Hub] '${req.agentRole}' için tüm aday modeller başarısız oldu:\n` +
        errors.join("\n")
    );
  }

  /**
   * Ses transkripsiyonu için merkezi AI Hub metodu (Groq Whisper -> Gemini Audio).
   * Asla sahte (mock) metin döndürmez; tüm sağlayıcılar başarısız olursa hata fırlatır.
   */
  static async transcribeAudio(audioPath: string): Promise<TranscriptResult> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Ses dosyası bulunamadı: ${audioPath}`);
    }

    const config = loadToprakConfig();
    const errors: string[] = [];

    for (const candidate of AUDIO_TRANSCRIPTION_MODELS) {
      try {
        if (candidate.provider === "groq") {
          if (!config.groqApiKey) {
            errors.push(`${candidate.modelId}: GROQ_API_KEY tanımlı değil.`);
            continue;
          }
          return await this.transcribeWithGroq(
            audioPath,
            candidate.modelId,
            config.groqApiKey
          );
        }

        if (candidate.provider === "gemini") {
          if (!config.geminiApiKey) {
            errors.push(`${candidate.modelId}: GEMINI_API_KEY tanımlı değil.`);
            continue;
          }
          return await this.transcribeWithGeminiSdk(
            audioPath,
            candidate.modelId,
            config.geminiApiKey
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Toprak AI Hub] Ses çözümü (${candidate.modelId}) başarısız: ${msg.slice(0, 140)}`
        );
        errors.push(`${candidate.modelId}: ${msg}`);
      }
    }

    throw new Error(
      `[Toprak AI Hub] Ses transkripsiyonu başarısız oldu (sahte metin üretimi kapalıdır):\n` +
        errors.join("\n")
    );
  }

  /**
   * Görsel üretimi için merkezi AI Hub metodu.
   */
  static async generateImage(prompt: string, aspectRatio: "9:16" | "1:1" = "9:16"): Promise<AiHubImageResponse | null> {
    const config = loadToprakConfig();
    if (!config.geminiApiKey) {
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const startTime = Date.now();

    for (const candidate of IMAGE_GENERATION_MODELS) {
      try {
        if (candidate.api === "interactions") {
          const interaction = await Promise.race([
            ai.interactions.create({
              model: candidate.modelId,
              input: prompt,
              response_format: { type: "image" },
              generation_config: {
                image_config: {
                  aspect_ratio: aspectRatio,
                },
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Gemini Interactions Image timeout (25s)")), 25000)
            ),
          ]);

          if (interaction.output_image?.data) {
            return {
              buffer: Buffer.from(interaction.output_image.data, "base64"),
              modelUsed: candidate.modelId,
              provider: "gemini",
              durationMs: Date.now() - startTime,
            };
          }
        } else {
          const genRes = await Promise.race([
            ai.models.generateContent({
              model: candidate.modelId,
              contents: prompt,
              config: {
                imageConfig: {
                  aspectRatio,
                },
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Gemini Image timeout (25s)")), 25000)
            ),
          ]);

          const parts = genRes.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              return {
                buffer: Buffer.from(part.inlineData.data, "base64"),
                modelUsed: candidate.modelId,
                provider: "gemini",
                durationMs: Date.now() - startTime,
              };
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Toprak AI Hub] Görsel modeli (${candidate.modelId}) atlandı: ${msg.slice(0, 120)}`);
      }
    }

    return null;
  }

  /**
   * Duygulu / oyunculuk direktifli Türkçe AI seslendirme (Gemini 3.8 Expressive TTS).
   * Başarısız veya kota dolu olursa null döner; TtsEngine Tier-2 Microsoft Neural Edge-TTS'e devreder.
   */
  static async synthesizeSpeech(opts: {
    text: string;
    styleDirective?: string;
    voiceName?: string;
    language?: string;
  }): Promise<AiHubSpeechResponse | null> {
    const config = loadToprakConfig();
    if (!config.geminiApiKey || !opts.text.trim()) {
      return null;
    }

    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const startTime = Date.now();
    const voice = opts.voiceName || "Sulafat";
    const style =
      opts.styleDirective?.trim() ||
      "Doğal, akıcı, sıcak ve enerjik bir Türkçe sosyal medya anlatıcısı gibi seslendir; robotik duraksamalardan kaçın.";

    for (const candidate of SPEECH_SYNTHESIS_MODELS) {
      try {
        await this.applyRateLimitGuard(candidate.provider, candidate.modelId);
        const interaction = await Promise.race([
          ai.interactions.create({
            model: candidate.modelId,
            input: [
              {
                type: "user_input",
                content: [
                  {
                    type: "text",
                    text: opts.text,
                    annotations: [
                      {
                        type: "speech_metadata",
                        style,
                      },
                    ],
                  },
                ],
              },
            ],
            response_format: { type: "audio" },
            generation_config: {
              speech_config: [
                {
                  voice,
                  language: opts.language || "tr-TR",
                },
              ],
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Gemini TTS timeout (${candidate.modelId})`)), 28000)
          ),
        ]);

        if (interaction.output_audio?.data) {
          const buf = Buffer.from(interaction.output_audio.data, "base64");
          if (buf.length > 500) {
            return {
              audioBuffer: buf,
              mimeType: interaction.output_audio.mime_type || "audio/wav",
              modelUsed: candidate.modelId,
              provider: "gemini",
              durationMs: Date.now() - startTime,
            };
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[Toprak AI Hub] Ses modeli (${candidate.modelId}) atlandı: ${msg.slice(0, 140)}`
        );
      }
    }

    return null;
  }

  // --- YARDIMCI METOTLAR ---

  private static async applyRateLimitGuard(provider: string, modelId: string): Promise<void> {
    const key = `${provider}:${modelId}`;
    const lastTime = this.lastCallTimes.get(key) || 0;
    const elapsed = Date.now() - lastTime;
    const minDelayMs = modelId.includes("120b") ? 450 : 150;
    if (elapsed < minDelayMs) {
      await new Promise((r) => setTimeout(r, minDelayMs - elapsed));
    }
    this.lastCallTimes.set(key, Date.now());
  }

  private static async callGroq(
    spec: AiModelSpec,
    apiKey: string,
    req: AiHubDispatchRequest
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemInstruction) {
      messages.push({ role: "system", content: req.systemInstruction });
    }
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = {
      model: spec.modelId,
      messages,
      temperature: spec.temperature,
      max_completion_tokens: 4800,
      // Qwen vb. modellerde JSON modunda düşünme etiketlerinin JSON'u bozmasını önlemek için json_object kipi
      ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(spec.timeoutMs ?? 30000),
    });

    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      throw new Error("Groq HTTP 429 Rate Limit");
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq yanıtında metin bulunamadı.");
    return content;
  }

  private static async callGeminiSdk(
    spec: AiModelSpec,
    apiKey: string,
    req: AiHubDispatchRequest
  ): Promise<string> {
    const ai = new GoogleGenAI({ apiKey });

    // Not: Gemini API'de responseMimeType: "application/json" ile googleSearch tool aynı anda kullanılamayabilir;
    // web araması istendiğinde JSON'u metin içinden cleanJsonText ile ayrıştırıyoruz.
    const useSearchTool = Boolean(spec.useWebSearch && !req.jsonMode);

    const response = await Promise.race([
      ai.models.generateContent({
        model: spec.modelId,
        contents: req.prompt,
        config: {
          temperature: spec.temperature,
          ...(req.systemInstruction ? { systemInstruction: req.systemInstruction } : {}),
          ...(req.jsonMode && !useSearchTool
            ? { responseMimeType: "application/json" }
            : {}),
          ...(useSearchTool ? { tools: [{ googleSearch: {} }] } : {}),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Gemini timeout (${spec.timeoutMs ?? 25000}ms)`)),
          spec.timeoutMs ?? 25000
        )
      ),
    ]);

    const txt = response.text?.trim();
    if (!txt) {
      throw new Error("Gemini yanıtında metin bulunamadı.");
    }
    return txt;
  }

  private static async callOpenAi(
    spec: AiModelSpec,
    apiKey: string,
    req: AiHubDispatchRequest
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (req.systemInstruction) {
      messages.push({ role: "system", content: req.systemInstruction });
    }
    messages.push({ role: "user", content: req.prompt });

    const body: Record<string, unknown> = {
      model: spec.modelId,
      messages,
      temperature: spec.temperature,
      ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(spec.timeoutMs ?? 25000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI yanıtında metin bulunamadı.");
    return content;
  }

  private static async transcribeWithGroq(
    audioPath: string,
    modelId: string,
    apiKey: string
  ): Promise<TranscriptResult> {
    const fileBuffer = fs.readFileSync(audioPath);
    const blob = new Blob([fileBuffer], { type: "audio/mpeg" });
    const formData = new FormData();
    formData.append("file", blob, path.basename(audioPath));
    formData.append("model", modelId);
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "word");
    formData.append("language", "tr");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq Whisper HTTP ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      words?: Array<{ word: string; start: number; end: number }>;
    };

    const words: WordTimestamp[] = Array.isArray(data.words)
      ? data.words.map((w) => ({
          word: w.word.trim(),
          start: Number(w.start),
          end: Number(w.end),
        }))
      : [];

    if (!data.text || !data.text.trim()) {
      throw new Error("Ses kaydında konuşma metni tespit edilemedi.");
    }

    return {
      fullText: data.text.trim(),
      language: data.language || "tr",
      durationSec: Number(data.duration) || 0,
      words,
    };
  }

  private static async transcribeWithGeminiSdk(
    audioPath: string,
    modelId: string,
    apiKey: string
  ): Promise<TranscriptResult> {
    const ai = new GoogleGenAI({ apiKey });
    const fileBuffer = fs.readFileSync(audioPath);
    const base64Audio = fileBuffer.toString("base64");
    const mimeType = audioPath.endsWith(".wav") ? "audio/wav" : "audio/mp3";

    const prompt = `Bu ses kaydını dinle ve Türkçe transkriptini kelime kelime zaman damgalarıyla çıkar.
YALNIZCA geçerli bir JSON döndür:
{
  "fullText": "Tüm konuşma metni",
  "durationSec": 15.0,
  "words": [
    { "word": "Örnek", "start": 0.0, "end": 0.5 }
  ]
}`;

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const txt = response.text?.trim();
    if (!txt) throw new Error("Gemini ses transkripti boş döndü.");

    const parsed = JSON.parse(this.cleanJsonText(txt)) as {
      fullText?: string;
      durationSec?: number;
      words?: WordTimestamp[];
    };

    if (!parsed.fullText?.trim()) {
      throw new Error("Gemini ses kaydında konuşma bulamadı.");
    }

    return {
      fullText: parsed.fullText.trim(),
      language: "tr",
      durationSec: Number(parsed.durationSec) || 0,
      words: Array.isArray(parsed.words) ? parsed.words : [],
    };
  }
}
