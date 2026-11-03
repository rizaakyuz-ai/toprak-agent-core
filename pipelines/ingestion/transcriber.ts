import fs from "node:fs";
import path from "node:path";
import { ToprakAiHub } from "../../core/ai-hub";
import { TranscriptResult, WordTimestamp } from "../../core/types";

export class Transcriber {
  /**
   * Ses dosyasını Merkezi AI Hub (Groq Whisper Large-v3 -> Turbo -> Gemini Audio) üzerinden
   * kelime kelime zaman damgalarıyla metne dönüştürür.
   * Sahte (mock) metin üretimi tamamen kaldırılmıştır.
   */
  static async transcribe(audioPath: string, outputDir: string): Promise<TranscriptResult> {
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Ses dosyası bulunamadı: ${audioPath}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const result = await ToprakAiHub.transcribeAudio(audioPath);

    // Eğer sağlayıcı kelime damgası döndürmediyse metinden yaklaşık zaman damgası üret
    if ((!result.words || result.words.length === 0) && result.fullText) {
      result.words = this.approximateWordTimestamps(
        result.fullText,
        result.durationSec || 10
      );
    }

    const srt = this.generateSrt(result.words);
    result.srtContent = srt;

    const baseName = path.basename(audioPath, path.extname(audioPath));
    const srtPath = path.join(outputDir, `${baseName}.srt`);
    const jsonPath = path.join(outputDir, `${baseName}_transcript.json`);

    fs.writeFileSync(srtPath, srt, "utf-8");
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");

    return result;
  }

  private static approximateWordTimestamps(
    text: string,
    durationSec: number
  ): WordTimestamp[] {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const usableDuration = Math.max(2, durationSec);
    const step = usableDuration / tokens.length;
    return tokens.map((word, idx) => ({
      word,
      start: Number((idx * step).toFixed(2)),
      end: Number(((idx + 1) * step).toFixed(2)),
    }));
  }

  private static generateSrt(words: WordTimestamp[]): string {
    if (!words || words.length === 0) return "";

    const chunks: Array<{ text: string; start: number; end: number }> = [];
    const CHUNK_SIZE = 4;

    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const slice = words.slice(i, i + CHUNK_SIZE);
      const text = slice.map((w) => w.word).join(" ");
      const start = slice[0].start;
      const end = slice[slice.length - 1].end;
      chunks.push({ text, start, end });
    }

    return chunks
      .map((c, idx) => {
        return `${idx + 1}\n${this.formatTime(c.start)} --> ${this.formatTime(c.end)}\n${c.text}\n`;
      })
      .join("\n");
  }

  private static formatTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
  }
}
