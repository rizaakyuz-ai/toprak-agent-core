import fs from "node:fs";
import path from "node:path";
import { WordTimestamp } from "../../core/types";

export interface AssSubtitleOptions {
  fontName?: string;
  fontSize?: number;
  primaryColor?: string;
  accentColorHex?: string;
  brandKeywords?: string[];
  outlineColor?: string;
  maxWordsPerLine?: number;
}

export class SubtitleGenerator {
  /**
   * TTS seslendirmesi için konuşma metninden kalibre edilmiş süreye orantılı kelime zaman damgaları hesaplar.
   * Noktalama işaretlerine (virgül, nokta, soru işareti) doğal mikro es ağırlığı ekler.
   */
  static estimateWordTimestamps(
    text: string,
    totalDurationSec: number
  ): WordTimestamp[] {
    const cleaned = text
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return [];

    const words = cleaned.split(" ").filter(Boolean);
    if (words.length === 0) return [];

    const effectiveDuration = Math.max(2.0, totalDurationSec - 0.25);
    const weights = words.map((w) => {
      let base = Math.max(2.2, w.length);
      if (/[.!?]$/.test(w)) base += 3.0;
      else if (/[,;:]$/.test(w)) base += 1.5;
      return base;
    });
    const totalWeight = weights.reduce((sum, v) => sum + v, 0);

    let cursor = 0.1;
    return words.map((word, idx) => {
      const wordDur = (weights[idx] / totalWeight) * effectiveDuration;
      const start = Number(cursor.toFixed(2));
      cursor += wordDur;
      const end = Number(cursor.toFixed(2));
      return { word, start, end };
    });
  }

  private static hexToAssBgr(hex?: string, fallbackAss = "&H00FB40E0"): string {
    if (!hex) return fallbackAss;
    const m = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(m)) return fallbackAss;
    const r = m.slice(0, 2).toUpperCase();
    const g = m.slice(2, 4).toUpperCase();
    const b = m.slice(4, 6).toUpperCase();
    return `&H00${b}${g}${r}`;
  }

  /**
   * Kelime zaman damgalarından dikey videolara (Reels/TikTok/Shorts) uygun,
   * markanın kurumsal yazı tipini ve vurgu rengini kullanan Türkçe ('tr-TR') ASS altyazı dosyası üretir.
   */
  static generateAss(
    words: WordTimestamp[],
    outputPath: string,
    opts?: AssSubtitleOptions
  ): string {
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const fontName = (opts?.fontName || "Segoe UI").replace(/,/g, "").trim();
    const fontSize = opts?.fontSize || 46;
    const primaryColorAss = "&H00FFFFFF";
    const accentAss = this.hexToAssBgr(opts?.accentColorHex, "&H004FD5FF");
    const outlineColorAss = "&H00140A08";

    const brandKeywordSet = new Set(
      (opts?.brandKeywords || [])
        .map((k) => k.trim().toLocaleUpperCase("tr-TR"))
        .filter((k) => k.length >= 2)
    );
    brandKeywordSet.add("AI");

    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ReelsStyle,${fontName},${fontSize},${primaryColorAss},${accentAss},${outlineColorAss},&H88000000,-1,0,0,0,100,100,1.2,0,1,4.5,2.5,2,75,75,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const chunkSize = opts?.maxWordsPerLine || 3;
    const events: string[] = [];

    for (let i = 0; i < words.length; i += chunkSize) {
      const slice = words.slice(i, i + chunkSize);
      const start = this.formatAssTime(slice[0].start);
      const end = this.formatAssTime(
        Math.max(slice[0].start + 0.32, slice[slice.length - 1].end)
      );

      const formattedWords = slice.map((w) => {
        const cleanWord = w.word
          .replace(/[{}]/g, "")
          .replace(/\\/g, "")
          .toLocaleUpperCase("tr-TR");
        const bareToken = cleanWord.replace(/[^A-ZÇĞİÖŞÜ0-9]/gi, "");
        if (brandKeywordSet.has(bareToken)) {
          return `{\\c${accentAss}&}${cleanWord}{\\c${primaryColorAss}&}`;
        }
        return cleanWord;
      });

      events.push(
        `Dialogue: 0,${start},${end},ReelsStyle,,0,0,0,,{\\b1}${formattedWords.join(" ")}{\\b0}`
      );
    }

    const content = header + events.join("\n") + "\n";
    fs.writeFileSync(outputPath, content, "utf-8");
    return outputPath;
  }

  private static formatAssTime(seconds: number): string {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const cs = Math.floor((seconds - Math.floor(seconds)) * 100);
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
  }
}
