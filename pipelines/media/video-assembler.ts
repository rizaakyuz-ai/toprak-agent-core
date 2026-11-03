import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegBinaryPath from "ffmpeg-static";
import type { RenderedBrandVideoKit } from "../../core/brand-asset-resolver";

const execFileAsync = promisify(execFile);

export interface AssembleVideoOptions {
  inputVideoPath: string;
  outputPath: string;
  subtitleAssPath?: string;
  brandKit?: RenderedBrandVideoKit;
  targetWidth?: number;
  targetHeight?: number;
}

export class VideoAssembler {
  static getFfmpegPath(): string {
    if (ffmpegBinaryPath && fs.existsSync(ffmpegBinaryPath)) {
      return ffmpegBinaryPath;
    }
    return "ffmpeg";
  }

  /**
   * Ses veya video dosyasının gerçek süresini (saniye) FFmpeg üzerinden okur.
   */
  static async probeDurationSec(filePath: string): Promise<number> {
    if (!fs.existsSync(filePath)) return 0;
    const bin = this.getFfmpegPath();
    try {
      const probe = await execFileAsync(bin, ["-hide_banner", "-i", filePath]).catch(
        (e) => e
      );
      const stderr = probe && typeof probe.stderr === "string" ? probe.stderr : "";
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durMatch) {
        return (
          Number(durMatch[1]) * 3600 +
          Number(durMatch[2]) * 60 +
          Number(durMatch[3])
        );
      }
    } catch {
      // yoksay
    }
    return 0;
  }

  /**
   * Video dosyasının çözünürlük (width/height), süre ve ses izi (hasAudio) bilgilerini okur.
   */
  static async probeMediaStreamInfo(filePath: string): Promise<{
    width: number;
    height: number;
    durationSec: number;
    hasAudio: boolean;
  }> {
    const fallback = { width: 720, height: 1280, durationSec: 8, hasAudio: false };
    if (!fs.existsSync(filePath)) return fallback;
    const bin = this.getFfmpegPath();
    try {
      const probe = await execFileAsync(bin, ["-hide_banner", "-i", filePath]).catch(
        (e) => e
      );
      const stderr = probe && typeof probe.stderr === "string" ? probe.stderr : "";
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSec = durMatch
        ? Number(durMatch[1]) * 3600 +
          Number(durMatch[2]) * 60 +
          Number(durMatch[3])
        : 8;
      const dimMatch = stderr.match(/Stream\s+#\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5})\b/);
      const width = dimMatch ? Number(dimMatch[1]) : 720;
      const height = dimMatch ? Number(dimMatch[2]) : 1280;
      const hasAudio = /Stream\s+#\d+:\d+.*Audio:/i.test(stderr);
      return { width, height, durationSec, hasAudio };
    } catch {
      return fallback;
    }
  }

  /**
   * Yalnızca video yüklendiğinde kapak görseli (cover_photo.jpg) oluşturmak için videodan net bir kare çıkarır.
   */
  static async extractCoverFrame(
    videoPath: string,
    outputJpgPath: string,
    atSec = 1.2
  ): Promise<boolean> {
    if (!fs.existsSync(videoPath)) return false;
    const bin = this.getFfmpegPath();
    const outDir = path.dirname(outputJpgPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const info = await this.probeMediaStreamInfo(videoPath);
    const safeSec = Math.max(0, Math.min(atSec, Math.max(0, info.durationSec - 0.3)));

    try {
      await execFileAsync(bin, [
        "-y",
        "-ss",
        safeSec.toFixed(2),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        "-q:v",
        "2",
        outputJpgPath,
      ]);
      return fs.existsSync(outputJpgPath) && fs.statSync(outputJpgPath).size > 1000;
    } catch {
      return false;
    }
  }

  /**
   * 2.2 saniyelik animasyonlu Tam Ekran Kurumsal Kimlik Kapanış Kartı (Outro End-Card) MP4 segmenti üretir.
   */
  private static async renderCorporateOutroSegment(
    outroImagePath: string,
    segmentOutPath: string,
    width = 1080,
    height = 1920,
    fps = 25
  ): Promise<boolean> {
    if (!fs.existsSync(outroImagePath)) return false;
    const bin = this.getFfmpegPath();
    const outroDur = 2.2;
    const frames = Math.round(outroDur * fps); // 55 kare

    const scaleW = Math.round(width * 1.06);
    const scaleH = Math.round(height * 1.06);
    const vf =
      `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${scaleW}:${scaleH},` +
      `zoompan=z='min(zoom+0.0012,1.045)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},` +
      `fade=t=in:st=0:d=0.32,setsar=1,format=yuv420p`;

    try {
      // Hafif ve zarif kurumsal kapanış akoru (sonic logo tınısı)
      await execFileAsync(bin, [
        "-y",
        "-i",
        outroImagePath,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc='0.032*sin(2*PI*523.25*t)*exp(-1.8*t)+0.026*sin(2*PI*659.25*t)*exp(-1.8*t)+0.024*sin(2*PI*783.99*t)*exp(-1.8*t)':s=44100:c=stereo:d=${outroDur}`,
        "-t",
        String(outroDur),
        "-vf",
        vf,
        "-af",
        "afade=t=in:st=0:d=0.06,afade=t=out:st=1.5:d=0.65",
        "-r",
        String(fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-pix_fmt",
        "yuv420p",
        segmentOutPath,
      ]);
      return fs.existsSync(segmentOutPath) && fs.statSync(segmentOutPath).size > 1000;
    } catch {
      try {
        await execFileAsync(bin, [
          "-y",
          "-loop",
          "1",
          "-t",
          String(outroDur),
          "-i",
          outroImagePath,
          "-f",
          "lavfi",
          "-t",
          String(outroDur),
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          String(outroDur),
          "-vf",
          `scale=${width}:${height},fade=t=in:st=0:d=0.3,setsar=1,format=yuv420p`,
          "-r",
          String(fps),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-ar",
          "44100",
          "-ac",
          "2",
          "-pix_fmt",
          "yuv420p",
          segmentOutPath,
        ]);
        return fs.existsSync(segmentOutPath) && fs.statSync(segmentOutPath).size > 1000;
      } catch {
        return false;
      }
    }
  }

  /**
   * Ana sahne videosu ile kurumsal kapanış (Outro) segmentini kesintisiz birleştirir.
   */
  private static async concatMainAndOutro(
    mainSegmentPath: string,
    outroSegmentPath: string,
    finalOutputPath: string
  ): Promise<boolean> {
    const bin = this.getFfmpegPath();
    try {
      await execFileAsync(bin, [
        "-y",
        "-i",
        mainSegmentPath,
        "-i",
        outroSegmentPath,
        "-filter_complex",
        "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]",
        "-map",
        "[outv]",
        "-map",
        "[outa]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        finalOutputPath,
      ]);
      return fs.existsSync(finalOutputPath) && fs.statSync(finalOutputPath).size > 2000;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Toprak VideoAssembler] Outro birleştirme uyarısı: ${msg.slice(0, 140)}`);
      return false;
    }
  }

  /**
   * Mod B: Ham videoyu 9:16 dikey formata getirir, kurumsal logo/orta-bant/altyazı gömer ve kapanış kartı ekler.
   */
  static async assembleVerticalVideo(opts: AssembleVideoOptions): Promise<string> {
    if (!fs.existsSync(opts.inputVideoPath)) {
      throw new Error(`Girdi videosu bulunamadı: ${opts.inputVideoPath}`);
    }

    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const bin = this.getFfmpegPath();
    const width = opts.targetWidth || 1080;
    const height = opts.targetHeight || 1920;
    const fps = 25;
    const rawDur = (await this.probeDurationSec(opts.inputVideoPath)) || 8;

    const hasWatermark = Boolean(
      opts.brandKit?.watermarkBadgePath && fs.existsSync(opts.brandKit.watermarkBadgePath)
    );
    const hasMidBanner = Boolean(
      opts.brandKit?.midLowerThirdPath && fs.existsSync(opts.brandKit.midLowerThirdPath)
    );
    const hasOutro = Boolean(
      opts.brandKit?.outroEndCardPath && fs.existsSync(opts.brandKit.outroEndCardPath)
    );

    const mainTargetPath = hasOutro
      ? path.join(outDir, `_main_modb_${Date.now()}.mp4`)
      : opts.outputPath;

    const inputs: string[] = ["-y", "-i", opts.inputVideoPath];
    let nextInputIdx = 1;
    let wmIdx = -1;
    let midIdx = -1;

    if (hasWatermark && opts.brandKit) {
      wmIdx = nextInputIdx++;
      inputs.push("-i", opts.brandKit.watermarkBadgePath);
    }
    if (hasMidBanner && opts.brandKit) {
      midIdx = nextInputIdx++;
      inputs.push("-i", opts.brandKit.midLowerThirdPath);
    }

    let filterComplex =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=25:5[bg];` +
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps},setsar=1[v0]`;

    let currentV = "v0";
    if (wmIdx !== -1) {
      filterComplex += `;[${currentV}][${wmIdx}:v]overlay=44:82[v_wm]`;
      currentV = "v_wm";
    }
    if (midIdx !== -1) {
      const midStart = Math.max(1.6, Number((rawDur * 0.32).toFixed(2)));
      const midEnd = Math.min(rawDur - 0.5, Number(Math.max(midStart + 2.4, rawDur * 0.66).toFixed(2)));
      filterComplex += `;[${currentV}][${midIdx}:v]overlay=(W-w)/2:1580:enable='between(t,${midStart},${midEnd})'[v_mid]`;
      currentV = "v_mid";
    }
    if (opts.subtitleAssPath && fs.existsSync(opts.subtitleAssPath)) {
      const escapedSubPath = opts.subtitleAssPath
        .replace(/\\/g, "/")
        .replace(/:/g, "\\:");
      filterComplex += `;[${currentV}]subtitles='${escapedSubPath}'[finalv]`;
    } else {
      filterComplex += `;[${currentV}]null[finalv]`;
    }

    const args = [
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[finalv]",
      "-map",
      "0:a?",
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mainTargetPath,
    ];

    try {
      await execFileAsync(bin, args);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.warn(
        `[Toprak VideoAssembler] Mod B filtreli kurgu uyarısı (${e.message}), sade dikey dönüştürme uygulanıyor...`
      );
      await execFileAsync(bin, [
        "-y",
        "-i",
        opts.inputVideoPath,
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},setsar=1`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mainTargetPath,
      ]);
    }

    if (hasOutro && opts.brandKit) {
      const outroSegPath = path.join(outDir, `_outro_modb_${Date.now()}.mp4`);
      const outroOk = await this.renderCorporateOutroSegment(
        opts.brandKit.outroEndCardPath,
        outroSegPath,
        width,
        height,
        fps
      );
      if (outroOk) {
        const concatOk = await this.concatMainAndOutro(
          mainTargetPath,
          outroSegPath,
          opts.outputPath
        );
        if (!concatOk) {
          fs.copyFileSync(mainTargetPath, opts.outputPath);
        }
      } else {
        fs.copyFileSync(mainTargetPath, opts.outputPath);
      }
      try {
        if (fs.existsSync(mainTargetPath)) fs.unlinkSync(mainTargetPath);
        if (fs.existsSync(outroSegPath)) fs.unlinkSync(outroSegPath);
      } catch {
        // yoksay
      }
    }

    if (!fs.existsSync(opts.outputPath) || fs.statSync(opts.outputPath).size < 1000) {
      throw new Error(`Dikey video üretilemedi: ${opts.outputPath}`);
    }

    return opts.outputPath;
  }

  /**
   * Mod A: Sahne görselinden, kalibre edilmiş Türkçe seslendirmeden, kurumsal kimlik katmanlarından
   * (sol üst logo + video ortası kurumsal bant + video sonu tam ekran kurumsal kapanış kartı)
   * ve dinamik Türkçe altyazıdan Ken Burns hareketli 9:16 Reels MP4 videosu üretir.
   */
  static async assembleMotionVideoFromImage(opts: {
    imagePath: string;
    outputPath: string;
    audioPath?: string;
    subtitleAssPath?: string;
    brandKit?: RenderedBrandVideoKit;
    durationSec?: number;
  }): Promise<string> {
    if (!fs.existsSync(opts.imagePath)) {
      throw new Error(`Video kaynak görseli bulunamadı: ${opts.imagePath}`);
    }

    const bin = this.getFfmpegPath();
    const width = 1080;
    const height = 1920;
    const fps = 25;

    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const hasAudio = Boolean(
      opts.audioPath &&
        fs.existsSync(opts.audioPath) &&
        fs.statSync(opts.audioPath).size > 200
    );

    let spokenDuration = opts.durationSec || 6.5;
    if (hasAudio && opts.audioPath) {
      const probed = await this.probeDurationSec(opts.audioPath);
      if (probed > 1) {
        spokenDuration = Math.max(4.5, Math.min(42, Number((probed + 0.35).toFixed(2))));
      }
    }

    const totalFrames = Math.max(115, Math.round(spokenDuration * fps));

    const hasWatermark = Boolean(
      opts.brandKit?.watermarkBadgePath && fs.existsSync(opts.brandKit.watermarkBadgePath)
    );
    const hasMidBanner = Boolean(
      opts.brandKit?.midLowerThirdPath && fs.existsSync(opts.brandKit.midLowerThirdPath)
    );
    const hasOutro = Boolean(
      opts.brandKit?.outroEndCardPath && fs.existsSync(opts.brandKit.outroEndCardPath)
    );

    const mainSegmentPath = hasOutro
      ? path.join(outDir, `_main_reels_${Date.now()}.mp4`)
      : opts.outputPath;

    // Girdiler: 0=Sahne Görseli, 1=Ses, 2=Logo Rozeti (varsa), 3=Orta Kurumsal Bant (varsa)
    const inputArgs: string[] = ["-y", "-i", opts.imagePath];
    if (hasAudio && opts.audioPath) {
      inputArgs.push("-i", opts.audioPath);
    } else {
      inputArgs.push(
        "-f",
        "lavfi",
        "-t",
        String(spokenDuration),
        "-i",
        "anullsrc=r=44100:cl=stereo"
      );
    }

    let nextIdx = 2;
    let wmIdx = -1;
    let midIdx = -1;

    if (hasWatermark && opts.brandKit) {
      wmIdx = nextIdx++;
      inputArgs.push("-i", opts.brandKit.watermarkBadgePath);
    }
    if (hasMidBanner && opts.brandKit) {
      midIdx = nextIdx++;
      inputArgs.push("-i", opts.brandKit.midLowerThirdPath);
    }

    let filterComplex =
      `[0:v]scale=1200:2134:force_original_aspect_ratio=increase,crop=1200:2134,` +
      `zoompan=z='min(zoom+0.00075,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps},setsar=1[v_base]`;

    let curV = "v_base";

    // Başlangıçtan itibaren Sol Üst Kurumsal Logo Rozeti
    if (wmIdx !== -1) {
      filterComplex += `;[${curV}][${wmIdx}:v]overlay=44:82[v_wm]`;
      curV = "v_wm";
    }

    // Videonun Ortasında Kurumsal Kimlik Bandı (Lower-Third)
    if (midIdx !== -1) {
      const midStart = Math.max(1.5, Number((spokenDuration * 0.30).toFixed(2)));
      const midEnd = Math.min(
        spokenDuration - 0.35,
        Number(Math.max(midStart + 2.5, spokenDuration * 0.68).toFixed(2))
      );
      filterComplex += `;[${curV}][${midIdx}:v]overlay=(W-w)/2:1580:enable='between(t,${midStart},${midEnd})'[v_mid]`;
      curV = "v_mid";
    }

    // Türkçe Dinamik Altyazı
    if (opts.subtitleAssPath && fs.existsSync(opts.subtitleAssPath)) {
      const escapedSubPath = opts.subtitleAssPath
        .replace(/\\/g, "/")
        .replace(/:/g, "\\:");
      filterComplex += `;[${curV}]subtitles='${escapedSubPath}'[v_out]`;
    } else {
      filterComplex += `;[${curV}]null[v_out]`;
    }

    // Ses izini tam konuşma süresine hizala (concat uyumu için 44.1kHz stereo)
    filterComplex += `;[1:a]aresample=44100,apad=whole_dur=${spokenDuration}[a_out]`;

    const fullMainArgs = [
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v_out]",
      "-map",
      "[a_out]",
      "-t",
      String(spokenDuration),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mainSegmentPath,
    ];

    try {
      await execFileAsync(bin, fullMainArgs);
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.warn(
        `[Toprak VideoAssembler] Çok katmanlı filtre uyarısı (${e.message}), temel dikey kurguya geçiliyor...`
      );
      await execFileAsync(bin, [
        "-y",
        "-loop",
        "1",
        "-t",
        String(spokenDuration),
        "-i",
        opts.imagePath,
        ...(hasAudio && opts.audioPath
          ? ["-i", opts.audioPath]
          : ["-f", "lavfi", "-t", String(spokenDuration), "-i", "anullsrc=r=44100:cl=stereo"]),
        "-t",
        String(spokenDuration),
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        mainSegmentPath,
      ]);
    }

    // Video Sonuna 2.2 Saniyelik Tam Ekran Kurumsal Kapanış Kartı (Outro) Ekle
    if (hasOutro && opts.brandKit) {
      const outroSegmentPath = path.join(outDir, `_outro_reels_${Date.now()}.mp4`);
      const outroRendered = await this.renderCorporateOutroSegment(
        opts.brandKit.outroEndCardPath,
        outroSegmentPath,
        width,
        height,
        fps
      );

      if (outroRendered) {
        const joined = await this.concatMainAndOutro(
          mainSegmentPath,
          outroSegmentPath,
          opts.outputPath
        );
        if (!joined) {
          fs.copyFileSync(mainSegmentPath, opts.outputPath);
        }
      } else {
        fs.copyFileSync(mainSegmentPath, opts.outputPath);
      }

      try {
        if (fs.existsSync(mainSegmentPath)) fs.unlinkSync(mainSegmentPath);
        if (fs.existsSync(outroSegmentPath)) fs.unlinkSync(outroSegmentPath);
      } catch {
        // yoksay
      }
    }

    if (!fs.existsSync(opts.outputPath) || fs.statSync(opts.outputPath).size < 1000) {
      throw new Error(`Hareketli Reels videosu oluşturulamadı: ${opts.outputPath}`);
    }

    const finalDur = await this.probeDurationSec(opts.outputPath);
    console.log(
      `[Toprak VideoAssembler] ✅ Kurumsal kimlikli 9:16 Dikey Reels videosu hazırlandı (${finalDur.toFixed(
        1
      )} sn): ${opts.outputPath}`
    );
    return opts.outputPath;
  }

  /**
   * Gemini Pro Web (Veo vb.) üzerinden indirilen gerçek AI videosunu alır;
   * - 9:16 dikeyse tam ekran 1080x1920 net ölçekler, yataysa bulanık dikey sahneyle çerçeveler,
   * - Seçime göre Toprak Türkçe seslendirmesini (AI->A-İ) hafif atmosfer sesiyle miksler veya videonun kendi sesini korur,
   * - Sol üst marka logosunu, orta bilgi bandını, Türkçe altyazıyı ve 2.2sn kurumsal kapanış kartını basar.
   */
  static async assembleGeminiProClip(opts: {
    inputVideoPath: string;
    outputPath: string;
    audioMode?: "TOPRAK_TTS_MIX" | "ORIGINAL_VIDEO_AUDIO";
    ttsAudioPath?: string;
    subtitleAssPath?: string;
    brandKit?: RenderedBrandVideoKit;
  }): Promise<string> {
    if (!fs.existsSync(opts.inputVideoPath)) {
      throw new Error(`Gemini Pro video dosyası bulunamadı: ${opts.inputVideoPath}`);
    }

    const bin = this.getFfmpegPath();
    const width = 1080;
    const height = 1920;
    const fps = 25;
    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const clipInfo = await this.probeMediaStreamInfo(opts.inputVideoPath);
    const useTts =
      opts.audioMode !== "ORIGINAL_VIDEO_AUDIO" &&
      Boolean(
        opts.ttsAudioPath &&
          fs.existsSync(opts.ttsAudioPath) &&
          fs.statSync(opts.ttsAudioPath).size > 200
      );

    let mainDuration = Math.max(4.5, clipInfo.durationSec || 8);
    if (useTts && opts.ttsAudioPath) {
      const ttsDur = await this.probeDurationSec(opts.ttsAudioPath);
      if (ttsDur > 1) {
        mainDuration = Math.max(4.5, Math.min(45, Number((ttsDur + 0.35).toFixed(2))));
      }
    }

    const hasWatermark = Boolean(
      opts.brandKit?.watermarkBadgePath && fs.existsSync(opts.brandKit.watermarkBadgePath)
    );
    const hasMidBanner = Boolean(
      opts.brandKit?.midLowerThirdPath && fs.existsSync(opts.brandKit.midLowerThirdPath)
    );
    const hasOutro = Boolean(
      opts.brandKit?.outroEndCardPath && fs.existsSync(opts.brandKit.outroEndCardPath)
    );

    const mainSegmentPath = hasOutro
      ? path.join(outDir, `_main_geminipro_${Date.now()}.mp4`)
      : opts.outputPath;

    // Seslendirme klibin süresinden uzunsa Veo videosunu kesintisiz döngüye al (-stream_loop -1)
    const needLoop = mainDuration > (clipInfo.durationSec || 8) - 0.15;
    const inputArgs: string[] = ["-y"];
    if (needLoop) {
      inputArgs.push("-stream_loop", "-1");
    }
    inputArgs.push("-i", opts.inputVideoPath);

    let ttsIdx = -1;
    let silentIdx = -1;
    let nextIdx = 1;

    if (useTts && opts.ttsAudioPath) {
      ttsIdx = nextIdx++;
      inputArgs.push("-i", opts.ttsAudioPath);
    } else if (!clipInfo.hasAudio) {
      silentIdx = nextIdx++;
      inputArgs.push(
        "-f",
        "lavfi",
        "-t",
        String(mainDuration),
        "-i",
        "anullsrc=r=44100:cl=stereo"
      );
    }

    let wmIdx = -1;
    let midIdx = -1;
    if (hasWatermark && opts.brandKit) {
      wmIdx = nextIdx++;
      inputArgs.push("-i", opts.brandKit.watermarkBadgePath);
    }
    if (hasMidBanner && opts.brandKit) {
      midIdx = nextIdx++;
      inputArgs.push("-i", opts.brandKit.midLowerThirdPath);
    }

    const isPortraitOrSquare = clipInfo.height >= clipInfo.width * 0.95;
    let filterComplex = isPortraitOrSquare
      ? `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v_base]`
      : `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=25:5[bg];` +
        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps},setsar=1[v_base]`;

    let curV = "v_base";
    if (wmIdx !== -1) {
      filterComplex += `;[${curV}][${wmIdx}:v]overlay=44:82[v_wm]`;
      curV = "v_wm";
    }
    if (midIdx !== -1) {
      const midStart = Math.max(1.5, Number((mainDuration * 0.30).toFixed(2)));
      const midEnd = Math.min(
        mainDuration - 0.35,
        Number(Math.max(midStart + 2.4, mainDuration * 0.68).toFixed(2))
      );
      filterComplex += `;[${curV}][${midIdx}:v]overlay=(W-w)/2:1580:enable='between(t,${midStart},${midEnd})'[v_mid]`;
      curV = "v_mid";
    }
    if (useTts && opts.subtitleAssPath && fs.existsSync(opts.subtitleAssPath)) {
      const escapedSubPath = opts.subtitleAssPath
        .replace(/\\/g, "/")
        .replace(/:/g, "\\:");
      filterComplex += `;[${curV}]subtitles='${escapedSubPath}'[v_out]`;
    } else {
      filterComplex += `;[${curV}]null[v_out]`;
    }

    if (useTts && ttsIdx !== -1) {
      if (clipInfo.hasAudio) {
        filterComplex +=
          `;[0:a]aresample=44100,volume=0.16,apad=whole_dur=${mainDuration}[bg_a]` +
          `;[${ttsIdx}:a]aresample=44100,volume=1.0,apad=whole_dur=${mainDuration}[vo_a]` +
          `;[bg_a][vo_a]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[a_out]`;
      } else {
        filterComplex += `;[${ttsIdx}:a]aresample=44100,apad=whole_dur=${mainDuration}[a_out]`;
      }
    } else if (clipInfo.hasAudio) {
      filterComplex += `;[0:a]aresample=44100,apad=whole_dur=${mainDuration}[a_out]`;
    } else {
      filterComplex += `;[${silentIdx}:a]aresample=44100,apad=whole_dur=${mainDuration}[a_out]`;
    }

    await execFileAsync(bin, [
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v_out]",
      "-map",
      "[a_out]",
      "-t",
      String(mainDuration),
      "-r",
      String(fps),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mainSegmentPath,
    ]);

    if (hasOutro && opts.brandKit) {
      const outroSegmentPath = path.join(outDir, `_outro_geminipro_${Date.now()}.mp4`);
      const outroRendered = await this.renderCorporateOutroSegment(
        opts.brandKit.outroEndCardPath,
        outroSegmentPath,
        width,
        height,
        fps
      );
      if (outroRendered) {
        const joined = await this.concatMainAndOutro(
          mainSegmentPath,
          outroSegmentPath,
          opts.outputPath
        );
        if (!joined) {
          fs.copyFileSync(mainSegmentPath, opts.outputPath);
        }
      } else {
        fs.copyFileSync(mainSegmentPath, opts.outputPath);
      }
      try {
        if (fs.existsSync(mainSegmentPath)) fs.unlinkSync(mainSegmentPath);
        if (fs.existsSync(outroSegmentPath)) fs.unlinkSync(outroSegmentPath);
      } catch {
        // yoksay
      }
    }

    if (!fs.existsSync(opts.outputPath) || fs.statSync(opts.outputPath).size < 1000) {
      throw new Error(`Gemini Pro kurumsal video kurgusu oluşturulamadı: ${opts.outputPath}`);
    }

    const finalDur = await this.probeDurationSec(opts.outputPath);
    console.log(
      `[Toprak VideoAssembler] ✨ Gemini Pro (Veo) kurumsal Reels videosu hazırlandı (${finalDur.toFixed(
        1
      )} sn): ${opts.outputPath}`
    );
    return opts.outputPath;
  }
}
