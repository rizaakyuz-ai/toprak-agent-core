import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BrandKnowledge, BrandProfile } from "./types";

export interface BrandVisualIdentity {
  slug: string;
  name: string;
  taglineUpper: string;
  domainLabel: string;
  secondaryDomainLabel?: string;
  outroSummaryText: string;
  primaryColor: string;
  accentColor: string;
  highlightColor: string;
  darkBgStart: string;
  darkBgEnd: string;
  headlineFontFamily: string;
  bodyFontFamily: string;
  assFontName: string;
  sourceLogoPath?: string;
  defaultVoiceGender: "Female" | "Male";
  defaultGeminiVoice: string;
}

export interface RenderedBrandVideoKit {
  identity: BrandVisualIdentity;
  watermarkBadgePath: string;
  midLowerThirdPath: string;
  outroEndCardPath: string;
}

export interface BrandIdentityInput {
  slug: string;
  name: string;
  sector?: string;
  websiteUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  tagline?: string;
  valueProposition?: string;
}

export class BrandAssetResolver {
  /**
   * C:\ dizinindeki marka proje klasörlerini (C:\Modena, C:\careerAi, C:\tabirai, C:\lappsoft_HQ\public\brand vb.)
   * tarayarak her markanın gerçek kurumsal renklerini, vektörel logosunu ve karakteristik yazı tipini çözer.
   */
  static resolveIdentity(brand: BrandIdentityInput | BrandProfile | BrandKnowledge): BrandVisualIdentity {
    const slug = brand.slug.toLowerCase().trim();

    if (slug === "modena") {
      const candidates = [
        "C:\\Modena\\modena_header_logo_transparent.svg",
        "C:\\Modena\\modena_header_logo.svg",
        "C:\\Modena\\modena_header_logo.png",
      ];
      return {
        slug,
        name: brand.name || "Modena",
        taglineUpper: "YAPAY ZEKA MODA DANIŞMANIN",
        domainLabel: "modenamoda.com.tr",
        secondaryDomainLabel: "lappsoft.com/projects/modena",
        outroSummaryText:
          "Hava durumu, görsel prova ve kişisel Stil DNA analiziyle akıllı dijital gardırobun.",
        primaryColor: "#7C4DFF", // Color.kt -> GlassLila
        accentColor: "#E040FB", // Color.kt -> NeonLila
        highlightColor: "#FFD54F", // Color.kt -> GoldAccent
        darkBgStart: "#1A0A40", // Color.kt -> PlusGradientStart
        darkBgEnd: "#0D1236", // Color.kt -> DeepNavy
        headlineFontFamily: "Georgia, 'Times New Roman', serif",
        bodyFontFamily: "'Segoe UI', Verdana, Arial, sans-serif",
        assFontName: "Segoe UI",
        sourceLogoPath: candidates.find((p) => fs.existsSync(p)),
        defaultVoiceGender: "Female",
        defaultGeminiVoice: "Sulafat", // Sıcak ve enerjik kadın sesi
      };
    }

    if (slug === "lappsoft-hq" || slug === "lappsoft") {
      const candidates = [
        "C:\\lappsoft_HQ\\public\\brand\\png\\logo-horizontal_color-on-dark.png",
        "C:\\lappsoft_HQ\\public\\brand\\png\\icon-signal_color-on-dark.png",
        "C:\\lappsoft\\lappsoft-web\\logo\\lappsoft_logo.png",
      ];
      return {
        slug,
        name: brand.name || "Lappsoft",
        taglineUpper: "AI LAB & SAAS YAZILIM STÜDYOSU",
        domainLabel: "lappsoft.com",
        outroSummaryText:
          "Yeni nesil yapay zeka ürünleri ve otonom yazılım çözümleri.",
        primaryColor: "#6DE675", // header_website SVG -> Signal Green
        accentColor: "#8F23CE", // header_website SVG -> Cyber Purple
        highlightColor: "#4ECAAD", // Cyber Teal
        darkBgStart: "#0D1B3E",
        darkBgEnd: "#060913",
        headlineFontFamily: "Bahnschrift, 'Segoe UI', Arial, sans-serif",
        bodyFontFamily: "'Segoe UI', Consolas, Arial, sans-serif",
        assFontName: "Bahnschrift",
        sourceLogoPath: candidates.find((p) => fs.existsSync(p)),
        defaultVoiceGender: "Male",
        defaultGeminiVoice: "Orus",
      };
    }

    if (slug === "career-ai" || slug === "careerai") {
      const candidates = [
        "C:\\careerAi\\logo\\careerai-app-icon.svg",
        "C:\\careerAi\\playstore\\careerai_playstore_icon_512.png",
        "C:\\lappsoft\\lappsoft-web\\out\\projects\\career-ai\\logo.png",
      ];
      return {
        slug,
        name: brand.name || "CareerAI",
        taglineUpper: "YAPAY ZEKA KARİYER KOÇUN",
        domainLabel: "careerai.lappsoft.com",
        secondaryDomainLabel: "lappsoft.com/projects/career-ai",
        outroSummaryText:
          "ATS uyumlu özgeçmiş analizi ve yapay zeka destekli kişisel kariyer koçun.",
        primaryColor: "#2563EB", // Color.kt -> PrimaryBlue
        accentColor: "#2DD4A7", // Color.kt -> AiSparkleGreen
        highlightColor: "#4F46E5", // Color.kt -> IndigoColor
        darkBgStart: "#1E293B",
        darkBgEnd: "#0F172A", // Color.kt -> DarkBackground
        headlineFontFamily: "'Segoe UI', Verdana, Arial, sans-serif",
        bodyFontFamily: "'Segoe UI', Arial, sans-serif",
        assFontName: "Segoe UI",
        sourceLogoPath: candidates.find((p) => fs.existsSync(p)),
        defaultVoiceGender: "Female",
        defaultGeminiVoice: "Kore",
      };
    }

    if (slug === "tabirai" || slug === "tabir-ai") {
      const candidates = [
        "C:\\tabirai\\playstore_screenshots\\tabirai_playstore_icon_512.png",
      ];
      return {
        slug,
        name: brand.name || "TabirAI",
        taglineUpper: "RÜYA & BİLİNÇALTI REHBERİN",
        domainLabel: "tabirai.com",
        secondaryDomainLabel: "lappsoft.com/projects/tabirai",
        outroSummaryText:
          "Rüyalarının sembol dilini ve bilinçaltı mesajlarını keşfet.",
        primaryColor: "#14B8A6", // Color.kt -> MysticIndigo / LuminousTeal
        accentColor: "#F59E0B", // Color.kt -> WarmAmberGold
        highlightColor: "#38BDF8", // Color.kt -> SoftPurple (Celestial Blue)
        darkBgStart: "#14172E",
        darkBgEnd: "#0C0E1E", // Color.kt -> DeepNightBackground
        headlineFontFamily: "Georgia, 'Palatino Linotype', serif", // Type.kt -> Serif
        bodyFontFamily: "'Segoe UI', Arial, sans-serif",
        assFontName: "Georgia",
        sourceLogoPath: candidates.find((p) => fs.existsSync(p)),
        defaultVoiceGender: "Female",
        defaultGeminiVoice: "Vindemiatrix",
      };
    }

    // Genel / Yeni Eklenen Markalar İçin Otomatik C:\ Taraması
    const dynamicCandidates = [
      `C:\\lappsoft\\lappsoft-web\\out\\projects\\${slug}\\logo.png`,
      `C:\\${slug}\\logo.svg`,
      `C:\\${slug}\\logo.png`,
    ];

    const normalizedGenericDomain = ("websiteUrl" in brand && brand.websiteUrl)
      ? brand.websiteUrl
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\/(?:www\.)?/, "")
          .replace(/\/+$/, "")
      : `${slug}.com`;

    return {
      slug,
      name: brand.name,
      taglineUpper: (brand.sector || brand.name).slice(0, 34).toLocaleUpperCase("tr-TR"),
      domainLabel: normalizedGenericDomain,
      outroSummaryText: this.smartTruncateWords(brand.sector || brand.name, 90),
      primaryColor: brand.primaryColor || "#3B82F6",
      accentColor: brand.accentColor || "#60A5FA",
      highlightColor: brand.accentColor || "#38BDF8",
      darkBgStart: "#1E293B",
      darkBgEnd: "#090D16",
      headlineFontFamily: "'Segoe UI', Arial, sans-serif",
      bodyFontFamily: "'Segoe UI', Arial, sans-serif",
      assFontName: "Segoe UI",
      sourceLogoPath: dynamicCandidates.find((p) => fs.existsSync(p)),
      defaultVoiceGender: "Female",
      defaultGeminiVoice: "Aoede",
    };
  }

  /**
   * Markanın şeffaf yatay kurumsal logosunu (Amblem + Wordmark) hedef genişlikte PNG Buffer olarak üretir.
   * C:\ altındaki gerçek SVG/PNG dosyalarını kullanır; SVG metin fontlarını Windows uyumlu hale getirir.
   */
  static async renderHorizontalLogoBuffer(
    identity: BrandVisualIdentity,
    targetWidth = 420
  ): Promise<Buffer> {
    // 1. Modena: C:\Modena\modena_header_logo_transparent.svg (veya gömülü çift kare + serif vektör)
    if (identity.slug === "modena") {
      let rawSvg = "";
      if (identity.sourceLogoPath && identity.sourceLogoPath.endsWith(".svg") && fs.existsSync(identity.sourceLogoPath)) {
        rawSvg = fs.readFileSync(identity.sourceLogoPath, "utf-8");
        rawSvg = rawSvg
          .replace(/'Noto Serif',\s*'Georgia',\s*serif/g, "Georgia, 'Times New Roman', serif")
          .replace(/'Inter',\s*-apple-system,\s*sans-serif/g, "'Segoe UI', Arial, sans-serif");
      } else {
        rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 110">
          <g transform="translate(24, 24)">
            <rect x="0" y="0" width="42" height="42" rx="10" fill="none" stroke="#7C4DFF" stroke-width="3.4"/>
            <rect x="16" y="16" width="42" height="42" rx="10" fill="none" stroke="#E040FB" stroke-width="3.4"/>
          </g>
          <g transform="translate(105, 30)">
            <text x="0" y="32" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#FFFFFF" letter-spacing="5">MODENA</text>
            <text x="2" y="54" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#CE93D8" letter-spacing="3.2">MODA DANIŞMANIN</text>
          </g>
        </svg>`;
      }
      return sharp(Buffer.from(rawSvg))
        .trim()
        .resize({ width: targetWidth })
        .png()
        .toBuffer();
    }

    // 2. Lappsoft HQ: C:\lappsoft_HQ\public\brand\png\logo-horizontal_color-on-dark.png
    if (
      (identity.slug === "lappsoft-hq" || identity.slug === "lappsoft") &&
      identity.sourceLogoPath &&
      fs.existsSync(identity.sourceLogoPath)
    ) {
      return sharp(identity.sourceLogoPath).resize({ width: targetWidth }).png().toBuffer();
    }

    // 3. TabirAI: TabirAiLogo.kt içindeki gerçek altın hilal + su yeşili 4 köşeli AI yıldızı vektörü
    if (identity.slug === "tabirai" || identity.slug === "tabir-ai") {
      const tabirSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 110">
        <defs>
          <radialGradient id="tbBg" cx="45%" cy="45%" r="65%">
            <stop offset="0%" stop-color="#14172E"/>
            <stop offset="100%" stop-color="#030712"/>
          </radialGradient>
          <linearGradient id="tbMoon" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#FDE047"/>
            <stop offset="55%" stop-color="#FACC15"/>
            <stop offset="100%" stop-color="#F59E0B"/>
          </linearGradient>
          <linearGradient id="tbStar" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#5EEAD4"/>
            <stop offset="100%" stop-color="#14B8A6"/>
          </linearGradient>
        </defs>
        <g transform="translate(18, 13)">
          <circle cx="42" cy="42" r="40" fill="url(#tbBg)" stroke="#333A6B" stroke-width="2"/>
          <path d="M 48 16 A 25 25 0 1 1 22 56 A 22 22 0 1 0 48 16 Z" fill="url(#tbMoon)"/>
          <path d="M 30 22 Q 32 31 41 33 Q 32 35 30 44 Q 28 35 19 33 Q 28 31 30 22 Z" fill="url(#tbStar)"/>
        </g>
        <g transform="translate(116, 28)">
          <text x="0" y="32" font-family="Georgia, serif" font-size="31" font-weight="bold" fill="#F8FAFC" letter-spacing="3">TABİR AI</text>
          <text x="2" y="54" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#14B8A6" letter-spacing="2.8">RÜYA &amp; BİLİNÇALTI</text>
        </g>
      </svg>`;
      return sharp(Buffer.from(tabirSvg)).resize({ width: targetWidth }).png().toBuffer();
    }

    // 4. CareerAI: C:\careerAi\logo\careerai-app-icon.svg (C2PA metadata temizlenmiş) + Yatay Wordmark
    if (identity.slug === "career-ai" || identity.slug === "careerai") {
      const careerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 110">
        <defs>
          <linearGradient id="caBg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#1B2E6B"/>
            <stop offset="1" stop-color="#0A1230"/>
          </linearGradient>
        </defs>
        <g transform="translate(18, 15)">
          <rect width="80" height="80" rx="20" fill="url(#caBg)" stroke="#2563EB" stroke-width="2"/>
          <g transform="scale(0.8)">
            <path d="M66 32A25 25 0 1 0 66 68" fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round"/>
            <path d="M76 37Q77.82 48.18 89 50Q77.82 51.82 76 63Q74.18 51.82 63 50Q74.18 48.18 76 37Z" fill="#2DD4A7"/>
          </g>
        </g>
        <g transform="translate(116, 28)">
          <text x="0" y="32" font-family="'Segoe UI', Arial, sans-serif" font-size="30" font-weight="900" fill="#F1F5F9" letter-spacing="2.5">CAREER AI</text>
          <text x="2" y="54" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="#2DD4A7" letter-spacing="2.6">KARİYER KOÇUN</text>
        </g>
      </svg>`;
      return sharp(Buffer.from(careerSvg)).resize({ width: targetWidth }).png().toBuffer();
    }

    // 5. Diğer markalar: Diskte PNG/SVG varsa ikon olarak sol tarafa yerleştir, yanına kurumsal tipografi ekle
    const targetHeight = Math.round(targetWidth * 0.26);
    const baseTextSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 114">
      <defs>
        <linearGradient id="genGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${this.escapeXml(identity.primaryColor)}"/>
          <stop offset="100%" stop-color="${this.escapeXml(identity.accentColor)}"/>
        </linearGradient>
      </defs>
      <rect x="18" y="19" width="76" height="76" rx="20" fill="url(#genGrad)"/>
      <text x="56" y="69" font-family="'Segoe UI', Arial, sans-serif" font-size="36" font-weight="900" fill="#FFFFFF" text-anchor="middle">${this.escapeXml(
        identity.name.slice(0, 1).toLocaleUpperCase("tr-TR")
      )}</text>
      <text x="112" y="58" font-family="'Segoe UI', Arial, sans-serif" font-size="30" font-weight="900" fill="#FFFFFF" letter-spacing="2">${this.escapeXml(
        identity.name.toLocaleUpperCase("tr-TR")
      )}</text>
      <text x="114" y="80" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="${this.escapeXml(
        identity.accentColor
      )}" letter-spacing="2">${this.escapeXml(identity.taglineUpper.slice(0, 26))}</text>
    </svg>`;

    if (identity.sourceLogoPath && fs.existsSync(identity.sourceLogoPath)) {
      try {
        const iconBuf = await sharp(identity.sourceLogoPath)
          .resize(76, 76, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer();
        const textOnlySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="114" viewBox="0 0 440 114">
          <text x="112" y="58" font-family="'Segoe UI', Arial, sans-serif" font-size="30" font-weight="900" fill="#FFFFFF" letter-spacing="2">${this.escapeXml(
            identity.name.toLocaleUpperCase("tr-TR")
          )}</text>
          <text x="114" y="80" font-family="'Segoe UI', Arial, sans-serif" font-size="11" font-weight="bold" fill="${this.escapeXml(
            identity.accentColor
          )}" letter-spacing="2">${this.escapeXml(identity.taglineUpper.slice(0, 26))}</text>
        </svg>`;
        return sharp(Buffer.from(textOnlySvg))
          .composite([{ input: iconBuf, left: 18, top: 19 }])
          .resize({ width: targetWidth })
          .png()
          .toBuffer();
      } catch {
        // alttaki SVG'ye düş
      }
    }

    return sharp(Buffer.from(baseTextSvg))
      .resize({ width: targetWidth, height: targetHeight, fit: "inside" })
      .png()
      .toBuffer();
  }

  /**
   * Videonun başında/boyunca sol üst köşe logo rozeti, ortasında kurumsal alt-bant (lower-third)
   * ve sonunda tam ekran kurumsal kapanış kartı (Outro End-Card) görsellerini üretir.
   */
  static async prepareVideoBrandKit(
    brand: BrandProfile | BrandKnowledge,
    workDir: string,
    opts?: { headline?: string; callToAction?: string }
  ): Promise<RenderedBrandVideoKit> {
    const identity = this.resolveIdentity(brand);
    const kitDir = path.join(workDir, "brand_kit");
    if (!fs.existsSync(kitDir)) {
      fs.mkdirSync(kitDir, { recursive: true });
    }

    // 1. Sol Üst Şeffaf Cam (Glassmorphic) Logo Filigran Rozeti (360x94)
    const watermarkBadgePath = path.join(kitDir, "watermark_badge.png");
    const smallLogoBuf = await this.renderHorizontalLogoBuffer(identity, 290);
    const smallMeta = await sharp(smallLogoBuf).metadata();
    const sw = smallMeta.width || 290;
    const sh = smallMeta.height || 72;
    const badgeW = sw + 44;
    const badgeH = Math.max(88, sh + 20);

    const badgeBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="${badgeH}" viewBox="0 0 ${badgeW} ${badgeH}">
      <rect x="2" y="2" width="${badgeW - 4}" height="${badgeH - 4}" rx="22" fill="${this.escapeXml(
        identity.darkBgEnd
      )}" fill-opacity="0.76" stroke="${this.escapeXml(identity.primaryColor)}" stroke-opacity="0.65" stroke-width="2"/>
    </svg>`;

    await sharp(Buffer.from(badgeBgSvg))
      .composite([
        {
          input: smallLogoBuf,
          left: Math.round((badgeW - sw) / 2),
          top: Math.round((badgeH - sh) / 2),
        },
      ])
      .png()
      .toFile(watermarkBadgePath);

    // 2. Video Ortası Kurumsal Kimlik Bandı (920x136)
    const midLowerThirdPath = path.join(kitDir, "mid_lower_third.png");
    const rawValueLine = this.stripEmojisForSvg(
      "tagline" in brand && brand.tagline
        ? brand.tagline
        : opts?.callToAction || identity.taglineUpper
    );
    const valueLine = this.smartTruncateWords(rawValueLine, 54);

    const midSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="136" viewBox="0 0 920 136">
      <defs>
        <linearGradient id="midAccent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.primaryColor)}"/>
          <stop offset="100%" stop-color="${this.escapeXml(identity.accentColor)}"/>
        </linearGradient>
      </defs>
      <rect x="4" y="8" width="912" height="120" rx="26" fill="${this.escapeXml(
        identity.darkBgEnd
      )}" fill-opacity="0.88" stroke="url(#midAccent)" stroke-width="2.5"/>
      <rect x="28" y="30" width="8" height="76" rx="4" fill="url(#midAccent)"/>
      <text x="56" y="62" font-family="${identity.headlineFontFamily}" font-size="26" font-weight="bold" fill="#FFFFFF" letter-spacing="2">${this.escapeXml(
        identity.name.toLocaleUpperCase("tr-TR")
      )}  •  ${this.escapeXml(identity.taglineUpper)}</text>
      <text x="56" y="98" font-family="${identity.bodyFontFamily}" font-size="22" font-weight="600" fill="#E2E8F0">${this.escapeXml(
        valueLine
      )}</text>
    </svg>`;

    await sharp(Buffer.from(midSvg)).png().toFile(midLowerThirdPath);

    // 3. Video Sonu Tam Ekran Kurumsal Kimlik Kapanış Kartı (Outro End-Card 1080x1920)
    const outroEndCardPath = path.join(kitDir, "outro_endcard.png");
    const largeLogoBuf = await this.renderHorizontalLogoBuffer(identity, 560);
    const largeMeta = await sharp(largeLogoBuf).metadata();
    const lw = largeMeta.width || 560;
    const lh = largeMeta.height || 145;

    const ctaRaw = this.stripEmojisForSvg(opts?.callToAction || "Hemen Keşfet & Deneyimle");
    const ctaShort = this.smartTruncateWords(ctaRaw, 46, false);
    const ctaFontSize = ctaShort.length > 36 ? 25 : ctaShort.length > 28 ? 28 : 31;

    const subLines = this.wrapText(identity.outroSummaryText, 42).slice(0, 2);
    const subSvg = subLines
      .map(
        (line, idx) =>
          `<text x="540" y="${965 + idx * 46}" font-family="${identity.bodyFontFamily}" font-size="30" font-weight="600" fill="#CBD5E1" text-anchor="middle">${this.escapeXml(
            line
          )}</text>`
      )
      .join("\n");

    const ctaBoxY = 965 + subLines.length * 46 + 66;
    const primaryDomainLower = identity.domainLabel.toLowerCase();
    const secondaryDomainLower = identity.secondaryDomainLabel?.toLowerCase();
    const secondaryDomainSvg = secondaryDomainLower
      ? `<text x="540" y="${ctaBoxY + 234}" font-family="${identity.bodyFontFamily}" font-size="24" font-weight="600" fill="#CBD5E1" text-anchor="middle" letter-spacing="1.4" opacity="0.92">${this.escapeXml(
          secondaryDomainLower
        )}</text>`
      : "";

    const outroBgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      <defs>
        <linearGradient id="outroBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.darkBgStart)}"/>
          <stop offset="55%" stop-color="${this.escapeXml(identity.darkBgEnd)}"/>
          <stop offset="100%" stop-color="#03050C"/>
        </linearGradient>
        <radialGradient id="glowTop" cx="50%" cy="35%" r="48%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.primaryColor)}" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="${this.escapeXml(identity.primaryColor)}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="glowBottom" cx="50%" cy="72%" r="42%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.accentColor)}" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="${this.escapeXml(identity.accentColor)}" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="ctaPill" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${this.escapeXml(identity.primaryColor)}"/>
          <stop offset="100%" stop-color="${this.escapeXml(identity.accentColor)}"/>
        </linearGradient>
      </defs>

      <rect width="1080" height="1920" fill="url(#outroBg)"/>
      <rect width="1080" height="1920" fill="url(#glowTop)"/>
      <rect width="1080" height="1920" fill="url(#glowBottom)"/>

      <!-- Üst ve Alt Kurumsal Çerçeve Çizgileri -->
      <rect x="140" y="540" width="800" height="3" rx="1.5" fill="url(#ctaPill)" opacity="0.6"/>
      <rect x="340" y="895" width="400" height="5" rx="2.5" fill="url(#ctaPill)"/>

      ${subSvg}

      <!-- CTA Aksiyon Butonu -->
      <rect x="110" y="${ctaBoxY}" width="860" height="96" rx="48" fill="url(#ctaPill)"/>
      <text x="540" y="${ctaBoxY + 59}" font-family="${identity.bodyFontFamily}" font-size="${ctaFontSize}" font-weight="900" fill="#FFFFFF" text-anchor="middle" letter-spacing="0.8">${this.escapeXml(
        ctaShort.toLocaleUpperCase("tr-TR")
      )}</text>

      <!-- Alt Kurumsal Web Adresleri (Her Zaman Küçük Harf & www Olmadan) -->
      <text x="540" y="${ctaBoxY + 188}" font-family="${identity.bodyFontFamily}" font-size="27" font-weight="bold" fill="${this.escapeXml(
        identity.highlightColor
      )}" text-anchor="middle" letter-spacing="1.6">${this.escapeXml(
        primaryDomainLower
      )}</text>
      ${secondaryDomainSvg}
    </svg>`;

    await sharp(Buffer.from(outroBgSvg))
      .composite([
        {
          input: largeLogoBuf,
          left: Math.round((1080 - lw) / 2),
          top: Math.round(715 - lh / 2),
        },
      ])
      .png()
      .toFile(outroEndCardPath);

    return {
      identity,
      watermarkBadgePath,
      midLowerThirdPath,
      outroEndCardPath,
    };
  }

  static stripEmojisForSvg(text: string): string {
    return text
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  static smartTruncateWords(text: string, maxChars: number, addEllipsis = false): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= maxChars) return clean;
    // Varsa ilk cümle/virgül sınırından kesmeyi dene
    const clauseCut = clean.slice(0, maxChars);
    const punctIdx = Math.max(
      clauseCut.lastIndexOf("."),
      clauseCut.lastIndexOf("!"),
      clauseCut.lastIndexOf(","),
      clauseCut.lastIndexOf("&")
    );
    if (punctIdx > Math.floor(maxChars * 0.55) && clean[punctIdx] !== "&") {
      return clauseCut.slice(0, punctIdx).trim();
    }
    const lastSpace = clauseCut.lastIndexOf(" ");
    const base = (lastSpace > 10 ? clauseCut.slice(0, lastSpace) : clauseCut)
      .replace(/[,;&:\-–—]+$/g, "")
      .trim();
    return addEllipsis ? `${base}...` : base;
  }

  static wrapText(text: string, maxCharsPerLine: number): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      if ((current + " " + w).trim().length > maxCharsPerLine) {
        if (current) lines.push(current.trim());
        current = w;
      } else {
        current = (current + " " + w).trim();
      }
    }
    if (current) lines.push(current.trim());
    return lines;
  }

  static escapeXml(unsafe: string): string {
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
