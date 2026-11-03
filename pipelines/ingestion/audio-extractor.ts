import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegBinaryPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export interface ExtractedAudioResult {
  audioPath: string;
  durationSec: number;
}

export class AudioExtractor {
  static getFfmpegPath(): string {
    if (ffmpegBinaryPath && fs.existsSync(ffmpegBinaryPath)) {
      return ffmpegBinaryPath;
    }
    // Windows fallback
    return "ffmpeg";
  }

  /**
   * Video dosyasından konuşma tanıma için optimize edilmiş (16kHz, mono, MP3/WAV) ses çıkarır.
   */
  static async extractAudio(videoPath: string, outputDir: string): Promise<ExtractedAudioResult> {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video dosyası bulunamadı: ${videoPath}`);
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const outputPath = path.join(outputDir, `${baseName}_audio.mp3`);

    const bin = this.getFfmpegPath();

    // 16kHz Mono MP3: Whisper ve Gemini için en hızlı ve en hafif format
    const args = [
      "-y",
      "-i", videoPath,
      "-vn",                  // Video akışını yoksay
      "-acodec", "libmp3lame",
      "-ar", "16000",         // 16kHz örnekleme oranı
      "-ac", "1",             // Mono kanal
      "-b:a", "64k",          // 64kbps ses kalitesi
      outputPath,
    ];

    try {
      await execFileAsync(bin, args);
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      throw new Error(`FFmpeg ses ayırma hatası: ${e.stderr || e.message}`);
    }

    // Süreyi öğrenmek için basit kontrol
    let durationSec = 0;
    try {
      const probe = await execFileAsync(bin, ["-hide_banner", "-i", outputPath]).catch(e => e);
      const stderr = (probe && probe.stderr) ? probe.stderr : "";
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durMatch) {
        durationSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
      }
    } catch {
      // opsiyonel
    }

    return {
      audioPath: outputPath,
      durationSec,
    };
  }
}
