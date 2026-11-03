import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegBinaryPath from "ffmpeg-static";
import { loadToprakConfig } from "../../core/config";
import { ToprakAiHub } from "../../core/ai-hub";

const execFileAsync = promisify(execFile);

export type EmotionPreset =
  | "EXCITED_INSPIRING"
  | "WARM_CONFIDENT"
  | "MYSTIC_CALM"
  | "SHARP_AUTHORITATIVE"
  | "CURIOUS_DYNAMIC";

export interface TtsOptions {
  /** Ekranda/altyazıda görünen orijinal Türkçe metin */
  text: string;
  /** Copywriter AI tarafından üretilmiş okunuş metni (varsa) */
  phoneticText?: string;
  /** Copywriter AI tarafından üretilmiş ses oyunculuğu ve duygu direktifi */
  styleDirective?: string;
  /** Copywriter AI tarafından seçilmiş duygu tonu */
  emotionPreset?: EmotionPreset;
  /** Marka slug bilgisi (özel telaffuz kuralları için) */
  brandSlug?: string;
  /** Gemini 3.8 TTS ses karakteri (örn. Sulafat, Orus, Kore, Vindemiatrix, Aoede) */
  preferredGeminiVoice?: string;
  /** Kadın / Erkek ses tercihi */
  voiceGender?: "Female" | "Male" | string;
  /** Hedef doğal Türkçe konuşma hızı (kelime/dakika, varsayılan ~148 WPM) */
  targetWpm?: number;
  outputPath: string;
  language?: string;
  voice?: string;
}

export class TurkishPhoneticNormalizer {
  /**
   * "3 saniyede", "15 saniyede", "saniyeler içinde" gibi kesin/abartılı saniye vaatlerini
   * "dakikalar içinde" / "kısa süreli" gibi gerçekçi ve kurumsal Türkçe ifadelere dönüştürür.
   */
  static sanitizeTimeClaimsTr(rawText: string): string {
    if (!rawText) return rawText;
    const matchCase = (replacement: string, match: string, offset: number, full: string): string => {
      const atSentenceStart =
        offset === 0 || /(?:^|[.!?…]\s+|\n\s*)$/.test(full.slice(0, offset));
      const startsUpper = /^[A-ZÇĞİÖŞÜ]/.test(match);
      if (atSentenceStart || startsUpper) {
        return replacement.charAt(0).toLocaleUpperCase("tr-TR") + replacement.slice(1);
      }
      return replacement;
    };

    return rawText
      .replace(
        /\b(?:sadece\s+|yalnızca\s+|birkaç\s+)?(?:\d+\s*(?:[-–]\s*\d+\s*)?)?saniyeler?\s+iç(?:in|erisin)de\b/giu,
        (m, off, full) => matchCase("dakikalar içinde", m, off, full)
      )
      .replace(
        /\b(?:sadece\s+|yalnızca\s+)?(?:birkaç|\d+(?:\s*[-–]\s*\d+)?)\s*saniyede\b/giu,
        (m, off, full) => matchCase("dakikalar içinde", m, off, full)
      )
      .replace(
        /\b(?:birkaç|\d+(?:\s*[-–]\s*\d+)?)\s*saniyelik\b/giu,
        (m, off, full) => matchCase("kısa süreli", m, off, full)
      )
      .replace(
        /\b(?:sadece\s+|yalnızca\s+)?\d+(?:\s*[-–]\s*\d+)?\s*saniye\b/giu,
        (m, off, full) => matchCase("birkaç dakika", m, off, full)
      );
  }

  /**
   * Yazılı metinlerde (başlık, açıklama, altyazı, ekran yazısı) LLM'in yanlışlıkla "A-İ" veya "A-R"
   * yazması durumunda bunları kurumsal yazılı forma ("AI", "AR", "Modena AI", "CareerAI", "TabirAI") geri çevirir.
   * Ayrıca kesin saniye vaatlerini ("15 saniyede" vb.) temizler.
   * Böylece YAZIDA her zaman "AI" görünür, OKUNURKEN ise "A-İ" olarak seslendirilir.
   */
  static toWrittenDisplayTurkish(rawText: string): string {
    if (!rawText) return rawText;
    return this.sanitizeTimeClaimsTr(rawText)
      .replace(/<\s*(?:short\s+pause|pause|breath|sigh|laugh)\s*>/gi, " ")
      .replace(/Modena\s*A[- ]?İ/giu, "Modena AI")
      .replace(/(?:Career|Kariyer)\s*A[- ]?İ/giu, "CareerAI")
      .replace(/Tabir\s*A[- ]?İ/giu, "TabirAI")
      .replace(/(?<![\p{L}\p{N}])A-İ(?![\p{L}\p{N}])/gu, "AI")
      .replace(/(?<![\p{L}\p{N}])Aİ(?![\p{L}\p{N}])/gu, "AI")
      .replace(/(?<![\p{L}\p{N}])A-R(?![\p{L}\p{N}])/gu, "AR")
      .replace(/(?<![\p{L}\p{N}])U-İ(?![\p{L}\p{N}])/gu, "UI")
      .replace(/(?<![\p{L}\p{N}])A-P-İ(?![\p{L}\p{N}])/gu, "API")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  /**
   * Yazıda "Modena AI", "CareerAI", "TabirAI", "AR" olarak kalan ifadeleri,
   * Türkçe seslendirme motorunun "A-ı" yerine doğru ince ünlüyle ("A-İ") ve doğru ek uyumuyla okuması için dönüştürür.
   * Altyazı ve ekran metinlerini ETKİLEMEZ; yalnızca ses motoruna giden metne uygulanır.
   */
  static toSpokenTurkish(rawText: string, _brandSlug?: string): string {
    let s = this.sanitizeTimeClaimsTr(rawText).replace(/\s+/g, " ").trim();
    if (!s) return s;

    // 1. Birleşik ve özel marka adlarını Türkçe fonetik okunuşa çevir (ekleriyle birlikte)
    s = s
      .replace(/Modena\s*AI/giu, "Modena A-İ")
      .replace(/Career\s*AI/giu, "Kariyer A-İ")
      .replace(/Tabir\s*AI/giu, "Tabir A-İ");

    // 2. "AI" / "A-I" / "A-İ" kısaltmasına gelen Türkçe kalın ünlü eklerini ince ünlü uyumuna ("İ") düzelt
    // Örn: "AI'ın" -> "A-İ'nin", "AI'ı" -> "A-İ'yi", "AI'a" -> "A-İ'ye", "AI'da" -> "A-İ'de", "AI'dan" -> "A-İ'den", "AI'la" -> "A-İ ile"
    s = s
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:ın|in|un|ün|nın|nin|nun|nün)(?![\p{L}\p{N}])/gu,
        "A-İ'nin"
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:ı|i|u|ü|yı|yi|yu|yü)(?![\p{L}\p{N}])/gu,
        "A-İ'yi"
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:a|e|ya|ye)(?![\p{L}\p{N}])/gu,
        "A-İ'ye"
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:da|de|ta|te)(?![\p{L}\p{N}])/gu,
        "A-İ'de"
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:dan|den|tan|ten)(?![\p{L}\p{N}])/gu,
        "A-İ'den"
      )
      .replace(
        /(?<![\p{L}\p{N}])(?:AI|Aİ|A-I|A-İ)\s*['’](?:la|le|yla|yle)(?![\p{L}\p{N}])/gu,
        "A-İ ile"
      );

    // 3. Yalın haldeki "AI" / "A-I" / "Ai" kısaltmalarını "A-İ" yap (Türkçe kelimelerin içini bozmaz)
    s = s
      .replace(/(?<![\p{L}\p{N}])(?:AI|A-I|Ai)(?![\p{L}\p{N}])/gu, "A-İ")
      .replace(/(?<![\p{L}\p{N}])AR(?![\p{L}\p{N}])/gu, "A-R")
      .replace(/(?<![\p{L}\p{N}])UI(?![\p{L}\p{N}])/gu, "U-İ")
      .replace(/(?<![\p{L}\p{N}])API(?![\p{L}\p{N}])/gu, "A-P-İ");

    // 4. Sembol ve sayısal ifadeleri doğal Türkçe konuşma diline çevir
    s = s
      .replace(/%\s*(\d+)/g, "yüzde $1")
      .replace(/(?<![\p{L}\p{N}])7\/24(?![\p{L}\p{N}])/gu, "yedi yirmi dört");

    return s.replace(/\s+/g, " ").trim();
  }

  /**
   * Edge-TTS veya Google TTS gibi inline etiket (<short pause> vb.) desteklemeyen motorlar için
   * oyunculuk etiketlerini doğal virgül eslerine dönüştürür.
   */
  static stripInlineTagsForStandardTts(spokenText: string): string {
    return spokenText
      .replace(/<\s*(?:short\s+pause|pause|breath|sigh|laugh)\s*>/gi, ", ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s*,\s*,+/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

const EMOTION_PROSODY_MAP: Record<EmotionPreset, { rate: string; pitch: string }> = {
  EXCITED_INSPIRING: { rate: "+22%", pitch: "+3Hz" },
  CURIOUS_DYNAMIC: { rate: "+20%", pitch: "+2Hz" },
  WARM_CONFIDENT: { rate: "+18%", pitch: "+1Hz" },
  SHARP_AUTHORITATIVE: { rate: "+19%", pitch: "-1Hz" },
  MYSTIC_CALM: { rate: "+13%", pitch: "-2Hz" },
};

export class TtsEngine {
  private static getFfmpegBin(): string {
    return ffmpegBinaryPath && fs.existsSync(ffmpegBinaryPath) ? ffmpegBinaryPath : "ffmpeg";
  }

  private static getEdgeTtsBin(): string {
    const venvBin = path.resolve(process.cwd(), "toprak", ".venv", "Scripts", "edge-tts.exe");
    if (fs.existsSync(venvBin)) return venvBin;
    const localVenvBin = path.resolve(__dirname, "..", "..", ".venv", "Scripts", "edge-tts.exe");
    if (fs.existsSync(localVenvBin)) return localVenvBin;
    return "edge-tts";
  }

  /**
   * Metni Türkçe fonetik kurallarıyla ("AI" -> "A-İ"), AI duygu direktifiyle ve
   * doğal Türkçe konuşma temposuyla (~145-155 kelime/dakika) MP3 ses dosyasına dönüştürür.
   */
  static async synthesize(opts: TtsOptions): Promise<string> {
    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const config = loadToprakConfig();
    const providerPref = config.ttsProvider;
    const lang = opts.language || "tr";

    const baseSourceText = (opts.phoneticText?.trim() || opts.text || "").slice(0, 620);
    const geminiSpokenText = TurkishPhoneticNormalizer.toSpokenTurkish(
      baseSourceText,
      opts.brandSlug
    );
    const cleanSpokenText = TurkishPhoneticNormalizer.stripInlineTagsForStandardTts(
      geminiSpokenText
    );

    const rawTmpPath = path.join(outDir, `_raw_tts_${Date.now()}.mp3`);
    let synthesizedOk = false;
    let engineUsed = "none";

    if (providerPref !== "silent" && cleanSpokenText.length > 0) {
      // Kademe 1: Merkezi AI Hub -> Gemini 3.8 Expressive TTS (Oyunculuk ve duygu direktifli)
      if (providerPref !== "edge") {
        const geminiOk = await this.tryGeminiExpressiveTts(
          geminiSpokenText,
          rawTmpPath,
          opts
        );
        if (geminiOk) {
          synthesizedOk = true;
          engineUsed = "gemini-expressive-tts";
        }
      }

      // Kademe 2: Microsoft Neural Edge-TTS (.venv/Scripts/edge-tts.exe + AI duygu prozodisi)
      if (!synthesizedOk) {
        const edgeOk = await this.tryEdgeTts(cleanSpokenText, rawTmpPath, opts);
        if (edgeOk) {
          synthesizedOk = true;
          engineUsed = "neural-edge-tts";
        }
      }

      // Kademe 3: Acil durum ağ yedeği (Ardından FFmpeg atempo ile doğal hıza kalibre edilir)
      if (!synthesizedOk) {
        const googleOk = await this.tryGoogleTtsChunked(cleanSpokenText, lang, rawTmpPath);
        if (googleOk) {
          synthesizedOk = true;
          engineUsed = "google-tts-calibrated";
        }
      }
    }

    if (synthesizedOk && fs.existsSync(rawTmpPath)) {
      await this.calibratePaceAndLoudness({
        inputPath: rawTmpPath,
        outputPath: opts.outputPath,
        cleanSpokenText,
        targetWpm: opts.targetWpm || 148,
        engineUsed,
      });
      try {
        if (fs.existsSync(rawTmpPath)) fs.unlinkSync(rawTmpPath);
      } catch {
        // geçici dosya silme hatasını yoksay
      }
      return opts.outputPath;
    }

    // Son Yedek: FFmpeg ile geçerli sessiz ses izi
    const bin = this.getFfmpegBin();
    const fallbackSeconds = Math.max(
      5,
      Math.min(14, Math.ceil(cleanSpokenText.split(/\s+/).length / 2.45))
    );

    await execFileAsync(bin, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      String(fallbackSeconds),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      opts.outputPath,
    ]);

    return opts.outputPath;
  }

  private static async tryGeminiExpressiveTts(
    spokenTextWithTags: string,
    outputMp3Path: string,
    opts: TtsOptions
  ): Promise<boolean> {
    try {
      const isMale = String(opts.voiceGender || "").toLowerCase().includes("male") &&
        !String(opts.voiceGender || "").toLowerCase().includes("female");
      const voiceName = opts.preferredGeminiVoice || (isMale ? "Orus" : "Sulafat");

      const res = await ToprakAiHub.synthesizeSpeech({
        text: spokenTextWithTags,
        styleDirective: opts.styleDirective,
        voiceName,
        language: "tr-TR",
      });

      if (!res || !res.audioBuffer || res.audioBuffer.length < 500) {
        return false;
      }

      const ext = res.mimeType.includes("mp3") || res.mimeType.includes("mpeg") ? "mp3" : "wav";
      const tmpIn = `${outputMp3Path}.gemini.${ext}`;
      fs.writeFileSync(tmpIn, res.audioBuffer);

      const bin = this.getFfmpegBin();
      await execFileAsync(bin, [
        "-y",
        "-i",
        tmpIn,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputMp3Path,
      ]);

      try {
        if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
      } catch {
        // yoksay
      }

      if (fs.existsSync(outputMp3Path) && fs.statSync(outputMp3Path).size > 800) {
        console.log(
          `[Toprak TtsEngine] 🎙️ Gemini Expressive TTS (${res.modelUsed} / ${voiceName}) ile duygulu seslendirme üretildi.`
        );
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Toprak TtsEngine] Gemini TTS atlandı: ${msg.slice(0, 120)}`);
      return false;
    }
  }

  private static async tryEdgeTts(
    cleanText: string,
    outputPath: string,
    opts: TtsOptions
  ): Promise<boolean> {
    try {
      const isMale =
        String(opts.voiceGender || "").toLowerCase().includes("male") &&
        !String(opts.voiceGender || "").toLowerCase().includes("female");

      const selectedVoice =
        opts.voice || (isMale ? "tr-TR-AhmetNeural" : "tr-TR-EmelNeural");

      const preset: EmotionPreset = opts.emotionPreset || "WARM_CONFIDENT";
      const prosody = EMOTION_PROSODY_MAP[preset] || EMOTION_PROSODY_MAP.WARM_CONFIDENT;
      // Edge-TTS tire işaretini hece duraksaması yapmasın diye "A-İ" -> "A İ" sadeleştirmesi
      const edgeSafeText = cleanText
        .replace(/A-İ/g, "A İ")
        .replace(/A-R/g, "A R")
        .replace(/U-İ/g, "U İ")
        .replace(/A-P-İ/g, "A P İ");

      const edgeBin = this.getEdgeTtsBin();
      await execFileAsync(edgeBin, [
        "--voice",
        selectedVoice,
        `--rate=${prosody.rate}`,
        `--pitch=${prosody.pitch}`,
        "--text",
        edgeSafeText,
        "--write-media",
        outputPath,
      ]);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 800) {
        console.log(
          `[Toprak TtsEngine] 🎙️ Neural Edge-TTS (${selectedVoice} | Duygu: ${preset} | Hız: ${prosody.rate}, Ton: ${prosody.pitch}) seslendirme oluşturuldu.`
        );
        return true;
      }
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Toprak TtsEngine] Neural Edge-TTS uyarısı: ${msg.slice(0, 140)}`);
      return false;
    }
  }

  /**
   * Üretilen sesin içindeki yapay boşlukları temizler, gerçek konuşma hızını (kelime/dakika) ölçer
   * ve ses yavaşsa pitch (ses inceliği) bozulmadan FFmpeg atempo + loudnorm ile ~148 WPM doğal Türkçe akışına kalibre eder.
   */
  private static async calibratePaceAndLoudness(params: {
    inputPath: string;
    outputPath: string;
    cleanSpokenText: string;
    targetWpm: number;
    engineUsed: string;
  }): Promise<void> {
    const bin = this.getFfmpegBin();
    const trimmedTmp = `${params.outputPath}.trimmed.mp3`;

    try {
      // 1. Başta/ortada >0.30sn yapay nefes boşluklarını daralt
      await execFileAsync(bin, [
        "-y",
        "-i",
        params.inputPath,
        "-af",
        "silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB:stop_periods=-1:stop_silence=0.26:stop_threshold=-45dB",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        trimmedTmp,
      ]);

      const sourceForProbe =
        fs.existsSync(trimmedTmp) && fs.statSync(trimmedTmp).size > 800
          ? trimmedTmp
          : params.inputPath;

      const durSec = await this.probeAudioDuration(sourceForProbe);
      const wordCount = params.cleanSpokenText
        .split(/\s+/)
        .filter((w) => w.length > 1 || /\p{L}/u.test(w)).length;

      let tempoFactor = 1.0;
      if (durSec > 1.2 && wordCount >= 4) {
        const actualWpm = (wordCount / durSec) * 60;
        if (actualWpm < 138) {
          // Yavaş okumayı doğal yayın temposuna (~148 WPM, en fazla 1.28x) çıkar
          tempoFactor = Math.min(1.28, Math.max(1.06, params.targetWpm / actualWpm));
        } else if (actualWpm > 182) {
          // Aşırı hızlıysa hafifçe anlaşılır tempoya çek
          tempoFactor = Math.max(0.90, params.targetWpm / actualWpm);
        }

        const calibratedWpm = Math.round(actualWpm * tempoFactor);
        console.log(
          `[Toprak TtsEngine] ⚡ Tempo Kalibrasyonu (${params.engineUsed}): Ham=${Math.round(
            actualWpm
          )} WPM (${durSec.toFixed(1)}sn) -> Çarpan=${tempoFactor.toFixed(
            2
          )}x -> Nihai=~${calibratedWpm} WPM`
        );
      }

      const afChain =
        Math.abs(tempoFactor - 1.0) >= 0.04
          ? `atempo=${tempoFactor.toFixed(2)},loudnorm=I=-16:TP=-1.5:LRA=11`
          : `loudnorm=I=-16:TP=-1.5:LRA=11`;

      await execFileAsync(bin, [
        "-y",
        "-i",
        sourceForProbe,
        "-af",
        afChain,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        params.outputPath,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Toprak TtsEngine] Kalibrasyon filtresi atlandı, ham ses kopyalanıyor: ${msg.slice(0, 120)}`);
      fs.copyFileSync(params.inputPath, params.outputPath);
    } finally {
      try {
        if (fs.existsSync(trimmedTmp)) fs.unlinkSync(trimmedTmp);
      } catch {
        // yoksay
      }
    }
  }

  private static async probeAudioDuration(filePath: string): Promise<number> {
    const bin = this.getFfmpegBin();
    try {
      const probe = await execFileAsync(bin, ["-hide_banner", "-i", filePath]).catch((e) => e);
      const stderr = probe && typeof probe.stderr === "string" ? probe.stderr : "";
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      }
    } catch {
      // yoksay
    }
    return 0;
  }

  private static splitIntoTtsChunks(text: string, maxChars = 175): string[] {
    const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
    const chunks: string[] = [];
    let current = "";

    for (const rawSentence of sentences) {
      const s = rawSentence.trim();
      if (!s) continue;
      if ((current + " " + s).trim().length <= maxChars) {
        current = (current + " " + s).trim();
      } else {
        if (current) chunks.push(current);
        if (s.length <= maxChars) {
          current = s;
        } else {
          const words = s.split(" ");
          let part = "";
          for (const w of words) {
            if ((part + " " + w).trim().length <= maxChars) {
              part = (part + " " + w).trim();
            } else {
              if (part) chunks.push(part);
              part = w;
            }
          }
          current = part;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private static async tryGoogleTtsChunked(
    text: string,
    lang: string,
    outputPath: string
  ): Promise<boolean> {
    try {
      const chunks = this.splitIntoTtsChunks(text, 175);
      if (chunks.length === 0) return false;

      const buffers: Buffer[] = [];
      for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(
          lang
        )}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 300) return false;
        buffers.push(buf);
      }

      const combined = Buffer.concat(buffers);
      fs.writeFileSync(outputPath, combined);
      return true;
    } catch {
      return false;
    }
  }
}
