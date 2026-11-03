import fs from "node:fs";
import path from "node:path";
import { BakedPackage } from "../../core/types";

export class PackageExporter {
  /**
   * Toprak fırınından çıkan ekmeği (nihai içerik paketini) diskte saklar ve özetler.
   */
  static exportPackage(pkg: BakedPackage, targetBaseDir: string): string {
    const batchDir = path.join(targetBaseDir, pkg.batchId);
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }

    const jsonPath = path.join(batchDir, "package.json");
    fs.writeFileSync(jsonPath, JSON.stringify(pkg, null, 2), "utf-8");

    const mdPath = path.join(batchDir, "ICERIK_OZETI.md");
    let promptsSection = "";
    if (pkg.productionPrompts) {
      promptsSection = `
---

## 🎥 Sinematik AI Prodüksiyon Promptları

### 🎬 Master Video Promptu:
\`\`\`text
${pkg.productionPrompts.videoPrompt.masterPromptEn}
\`\`\`
- **Kamera Hareketi:** ${pkg.productionPrompts.videoPrompt.cameraMovement}
- **Lens & Diyafram:** ${pkg.productionPrompts.videoPrompt.lensAndAperture}
- **Işık & Atmosfer:** ${pkg.productionPrompts.videoPrompt.lightingAndAtmosphere}
- **Aksiyon Kurgusu:** ${pkg.productionPrompts.videoPrompt.actionChoreography}
- **Negatif Prompt:** \`${pkg.productionPrompts.videoPrompt.negativePrompt}\`

### 📸 Master Fotoğraf Promptu:
\`\`\`text
${pkg.productionPrompts.photoPrompt.masterPromptEn}
\`\`\`
- **Kompozisyon:** ${pkg.productionPrompts.photoPrompt.composition}
- **Işıklandırma:** ${pkg.productionPrompts.photoPrompt.lighting}
`;
    }

    const approvalLine = pkg.socialHandoff
      ? `Social Onayı Bekliyor (${pkg.socialHandoff.approvalStatus} • ${pkg.socialHandoff.deliveriesCount} platform • Post: ${pkg.socialHandoff.postId})`
      : pkg.status;

    const mdContent = `# Fırından Çıkan Ekmek Paketi: ${pkg.batchId}

> **Marka:** ${pkg.brand.name} (${pkg.brand.slug})  
> **Sektör:** ${pkg.brand.sector}  
> **Mod:** ${pkg.sourceMode}  
> **Tarih:** ${pkg.createdAt}  
> **Kalite Skoru:** ${pkg.validation.overallScore}/100 (${pkg.validation.status}) • Revizyon: ${pkg.revisionCount}  
> **Social Durumu:** ${approvalLine}

---

## 📌 Kaynak Bilgisi
- **Konu:** ${pkg.sourceMetadata.topic}
- **Özet:** ${pkg.sourceMetadata.summary}
${promptsSection}
---

## 🎬 Medya Varlıkları
- **Dikey Video (Reels/TikTok/Shorts):** ${pkg.media.videoVertical?.fileName || "Üretilmedi"} (${pkg.media.videoVertical?.durationSec || 0} sn)
- **Kapak Görseli:** ${pkg.media.thumbnail?.fileName || "Üretilmedi"}

---

## 📱 Sağlıklı Platformlara Özgü İçerikler

${Object.entries(pkg.deliveries)
  .map(
    ([platform, content]) => `### Platform: ${platform.toUpperCase()} (${content.characterCount} kr)
- **Başlık:** ${content.headline}
- **Açılış Hook'u:** ${content.hookText || "Yok"}
- **Açıklama:**
${content.caption}

- **Etiketler:** ${content.hashtags.join(" ") || "(Yok)"}
- **Çağrı (CTA):** ${content.callToAction || "Yok"}
`
  )
  .join("\n---\n")}

---

## 🛡️ Kalite ve Denetim Notu
- **Ton Skoru:** ${pkg.validation.brandToneScore}/100
- **İmla Skoru:** ${pkg.validation.grammarScore}/100
- **Kanca Skoru:** ${pkg.validation.hookQualityScore}/100
- **Açıklama:** ${pkg.validation.improvementNotes}
`;

    fs.writeFileSync(mdPath, mdContent, "utf-8");
    return batchDir;
  }
}
