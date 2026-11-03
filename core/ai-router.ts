import {
  AGENT_MODEL_ROUTING,
  ToprakAgentRole,
  ToprakAiHub,
} from "./ai-hub";

export interface TextGenerationOptions {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  jsonMode?: boolean;
  agentRole?: ToprakAgentRole;
  preferredModels?: string[];
}

export interface ModelGenerationResult {
  text: string;
  modelUsed: string;
  provider: "gemini" | "groq" | "openai";
}

export const DEFAULT_MODEL_CASCADE = AGENT_MODEL_ROUTING.COPYWRITER_AGENT.map(
  (m) => m.modelId
);

/**
 * Geriye dönük uyumluluk sarmalayıcısı:
 * Tüm çağrıları merkezi ToprakAiHub üzerinden yönlendirir.
 */
export class ToprakAiRouter {
  static async generateText(opts: TextGenerationOptions): Promise<ModelGenerationResult> {
    const res = await ToprakAiHub.dispatch({
      agentRole: opts.agentRole || "COPYWRITER_AGENT",
      prompt: opts.prompt,
      systemInstruction: opts.systemInstruction,
      jsonMode: opts.jsonMode,
      temperatureOverride: opts.temperature,
      preferredModelOverride: opts.preferredModels?.[0],
    });

    return {
      text: res.text,
      modelUsed: res.modelUsed,
      provider: res.provider,
    };
  }
}
