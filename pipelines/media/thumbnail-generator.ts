import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BrandKnowledge, BrandProfile } from "../../core/types";
import { BrandAssetResolver } from "../../core/brand-asset-resolver";

export interface ThumbnailOptions {
  title: string;
  brand: BrandProfile | BrandKnowledge;
  outputPath: string;
  aspectRatio?: "9:16" | "1:1";
  backgroundImagePath?: string;
}

export class ThumbnailGenerator {
  /**
   * Markanın C:\ dizinindeki gerçek vektörel/PNG logosunu, kurumsal renk paletini ve
   * karakteristik yazı tipini kullanarak arka plan sahnesini kapatmayan,
   * hiçbir kelimesi kesilmeyen (dinamik font ölçeklemeli) editoryal kapak görseli üretir.
   */
  static async generateThumbnail(opts: ThumbnailOptions): Promise<string> {
    const isVertical = opts.aspectRatio !== "1:1";
    const width = 1080;
    const height = isVertical ? 1920 : 1080;
    const hasPhoto = Boolean(
      opts.backgroundImagePath &&
        fs.existsSync(opts.backgroundImagePath) &&
        fs.statSync(opts.backgroundImagePath).size > 500
    );

    const identity = BrandAssetResolver.resolveIdentity(opts.brand);
    const primaryColor = identity.primaryColor;
    const accentColor = identity.accentColor;

    // 1. Dinamik satır sarma ve otomatik font boyutu (Hiçbir kelime kesilmez; SVG emoji tel-kafes sorunu temizlenir)
    const cleanTitle = BrandAssetResolver.stripEmojisForSvg(opts.title)
      .replace(/\s+/g, " ")
      .trim();
    const charLen = cleanTitle.length;
    const maxCharsPerLine = charLen > 68 ? 24 : charLen > 46 ? 21 : 18;
    const wrappedLines = BrandAssetResolver.wrapText(cleanTitle, maxCharsPerLine);

    // Eğer 5 satırı aşarsa son satıra kalanları birleştirip fontu küçült
    let titleLines: string[];
    if (wrappedLines.length <= 5) {
      titleLines = wrappedLines;
    } else {
      titleLines = [
        ...wrappedLines.slice(0, 4),
        wrappedLines.slice(4).join(" "),
      ];
    }

    const longestLineLen = Math.max(...titleLines.map((l) => l.length), 1);
    let fontSize = 58;
    if (titleLines.length >= 5 || longestLineLen > 23) {
      fontSize = 44;
    } else if (titleLines.length === 4 || longestLineLen > 19) {
      fontSize = 50;
    }
    const lineHeight = Math.round(fontSize * 1.28);

    // 2. Gerçek Kurumsal Yatay Logoyu Hazırla (C:\ dizinindeki SVG/PNG'den)
    const logoTargetWidth = isVertical ? 380 : 320;
    const logoBuf = await BrandAssetResolver.renderHorizontalLogoBuffer(
      identity,
      logoTargetWidth
    );
    const logoMeta = await sharp(logoBuf).metadata();
    const lw = logoMeta.width || logoTargetWidth;
    const lh = logoMeta.height || 92;

    const topPillW = lw + 56;
    const topPillH = Math.max(98, lh + 24);
    const topPillX = Math.round((width - topPillW) / 2);
    const topPillY = isVertical ? 78 : 42;
    const logoLeft = Math.round((width - lw) / 2);
    const logoTop = Math.round(topPillY + (topPillH - lh) / 2);

    // 3. Alt-Orta Editoryal Tipografi Konumlandırması
    const totalTextBlockH = titleLines.length * lineHeight;
    const bottomAnchorY = isVertical ? 1650 : 915;
    const textStartY = bottomAnchorY - totalTextBlockH + fontSize;
    const categoryPillY = textStartY - fontSize - 64;

    const svgTextLines = titleLines
      .map((line, idx) => {
        const y = textStartY + idx * lineHeight;
        return `<text x="540" y="${y}" font-family="${identity.headlineFontFamily}" font-weight="900" font-size="${fontSize}" fill="#FFFFFF" text-anchor="middle" filter="url(#shadow)">${this.escapeXml(
          line.toLocaleUpperCase("tr-TR")
        )}</text>`;
      })
      .join("\n");

    const gradientDef = hasPhoto
      ? `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.darkBgEnd)}" stop-opacity="0.52" />
          <stop offset="16%" stop-color="${this.escapeXml(identity.darkBgEnd)}" stop-opacity="0.08" />
          <stop offset="48%" stop-color="${this.escapeXml(identity.darkBgEnd)}" stop-opacity="0.16" />
          <stop offset="70%" stop-color="${this.escapeXml(identity.darkBgStart)}" stop-opacity="0.80" />
          <stop offset="100%" stop-color="${this.escapeXml(identity.darkBgEnd)}" stop-opacity="0.96" />
        </linearGradient>`
      : `<linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.darkBgStart)}" stop-opacity="1" />
          <stop offset="58%" stop-color="${this.escapeXml(identity.darkBgEnd)}" stop-opacity="1" />
          <stop offset="100%" stop-color="#03050C" stop-opacity="1" />
        </linearGradient>`;

    const catLabel = identity.taglineUpper;
    const catPillW = Math.max(340, Math.min(760, catLabel.length * 19 + 84));
    const catPillX = Math.round((width - catPillW) / 2);
    const accentBarY = textStartY + (titleLines.length - 1) * lineHeight + 32;
    const domainY = accentBarY + 50;
    const primaryDomainLower = identity.domainLabel.toLowerCase();
    const secondaryDomainLower = identity.secondaryDomainLabel?.toLowerCase();
    const secondaryDomainSvg = secondaryDomainLower
      ? `<text x="540" y="${domainY + 36}" font-family="${identity.bodyFontFamily}" font-weight="600" font-size="20" fill="#CBD5E1" text-anchor="middle" letter-spacing="1.2" opacity="0.92">${this.escapeXml(
          secondaryDomainLower
        )}</text>`
      : "";

    const overlaySvg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        ${gradientDef}
        <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${this.escapeXml(primaryColor)}" />
          <stop offset="100%" stop-color="${this.escapeXml(accentColor)}" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="#000000" flood-opacity="0.85"/>
        </filter>
      </defs>

      <rect width="${width}" height="${height}" fill="url(#bgGrad)" />

      <!-- Üst Kurumsal Cam Logo Yuvası -->
      <rect x="${topPillX}" y="${topPillY}" width="${topPillW}" height="${topPillH}" rx="${Math.round(
      topPillH / 2
    )}" fill="${this.escapeXml(identity.darkBgEnd)}" fill-opacity="0.78" stroke="url(#brandGrad)" stroke-width="2.2" />

      <!-- Kategori / Slogan Rozeti -->
      <g filter="url(#shadow)">
        <rect x="${catPillX}" y="${categoryPillY}" width="${catPillW}" height="50" rx="25" fill="url(#brandGrad)" />
        <text x="540" y="${categoryPillY + 33}" font-family="${identity.bodyFontFamily}" font-weight="bold" font-size="21" fill="#FFFFFF" text-anchor="middle" letter-spacing="2.2">${this.escapeXml(
      catLabel
    )}</text>
      </g>

      <!-- Ana Başlık (Tamamı Sığdırılmış) -->
      ${svgTextLines}

      <!-- Kurumsal Vurgu Çizgisi ve Küçük Harfli Alan Adı İmzası -->
      <rect x="420" y="${accentBarY}" width="240" height="8" rx="4" fill="url(#brandGrad)" />
      <text x="540" y="${domainY}" font-family="${identity.bodyFontFamily}" font-weight="bold" font-size="23" fill="${this.escapeXml(
      identity.highlightColor
    )}" text-anchor="middle" letter-spacing="1.5" opacity="0.95">${this.escapeXml(
      primaryDomainLower
    )}</text>
      ${secondaryDomainSvg}
    </svg>`;

    const svgBuffer = Buffer.from(overlaySvg);

    const outDir = path.dirname(opts.outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const wantsPng = opts.outputPath.toLowerCase().endsWith(".png");

    const baseLayer = hasPhoto
      ? sharp(opts.backgroundImagePath!).resize(width, height, {
          fit: "cover",
          position: "attention",
        })
      : sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 9, g: 13, b: 26, alpha: 1 },
          },
        });

    const pipeline = baseLayer.composite([
      { input: svgBuffer, top: 0, left: 0 },
      { input: logoBuf, top: logoTop, left: logoLeft },
    ]);

    if (wantsPng) {
      await pipeline.png({ compressionLevel: 8 }).toFile(opts.outputPath);
    } else {
      await pipeline.jpeg({ quality: 92 }).toFile(opts.outputPath);
    }

    return opts.outputPath;
  }

  private static escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "&":
          return "&amp;";
        case "'":
          return "&apos;";
        case '"':
          return "&quot;";
        default:
          return c;
      }
    });
  }
}
