#!/usr/bin/env node
import fs from "node:fs";
import { loadToprakConfig } from "./core/config";
import { ToprakOrchestrator } from "./core/orchestrator";
import { BrandDiscovery } from "./core/brand-discovery";
import { ToprakAiHub } from "./core/ai-hub";
import { LearningEngine } from "./core/learning-engine";

async function main() {
  loadToprakConfig();
  const args = process.argv.slice(2);
  const command = args[0] || "help";

  console.log(`\n🌾 TOPRAK — Otonom İçerik Üretim Motoru (v2.0)`);
  console.log(`================================================`);

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`
Kullanılabilir Komutlar:

  1. list-brands
     Lappsoft Social'daki aktif markaları ve bağlı HEALTHY platformlarını listeler.
     Kullanım: npx tsx toprak/cli.ts list-brands

  2. test-models
     Merkezi AI Hub ajan-model yönlendirme tablosunu ve canlı sağlayıcı yanıtlarını test eder.
     Kullanım: npx tsx toprak/cli.ts test-models

  3. bake-topic
     Belirtilen markanın YALNIZCA HEALTHY platformları için içerik üretip Social 'Onay Bekliyor'a düşürür.
     Kullanım: npx tsx toprak/cli.ts bake-topic --brand modena [--topic "Özel konu"]

  4. bake-all
     HEALTHY hesabı bulunan TÜM markalar için otonom üretim yapıp Social 'Onay Bekliyor'a düşürür.
     Kullanım: npx tsx toprak/cli.ts bake-all

  5. bake-video
     Ham videoyu kurgular, Türkçe altyazı basar ve Social 'Onay Bekliyor'a düşürür.
     Kullanım: npx tsx toprak/cli.ts bake-video --brand modena --input "C:\\video.mp4"

  6. sync-learning
     Yayınlanmış gönderilerin gerçek metriklerini analiz edip ajan hafızasını günceller.
     Kullanım: npx tsx toprak/cli.ts sync-learning
`);
    return;
  }

  if (command === "list-brands") {
    const brands = await BrandDiscovery.getAllActiveBrands();
    console.log(`Lappsoft Social'da ${brands.length} aktif marka bulundu:\n`);
    for (const b of brands) {
      const statusTag =
        b.healthyPlatforms.length > 0
          ? `✅ ÜRETİME HAZIR (${b.healthyPlatforms.join(", ")})`
          : `⚠️ BAĞLI HEALTHY HESAP YOK (${b.accounts.length} hesap bağlı değil)`;
      console.log(`  • [${b.slug}] ${b.name} -> ${statusTag}`);
    }
    return;
  }

  if (command === "test-models") {
    const summary = ToprakAiHub.getRoutingTableSummary();
    console.log(`Merkezi AI Hub Ajan Yönlendirme Matrisi:\n`);
    for (const [role, specs] of Object.entries(summary.agents)) {
      console.log(
        `  • ${role.padEnd(18)} -> Birincil: ${specs[0].provider}/${specs[0].modelId} (Yedek sayısı: ${specs.length - 1})`
      );
    }

    console.log(`\nCanlı Yazar vs Denetçi Model Ayrımı Test Ediliyor...`);
    const writerRes = await ToprakAiHub.dispatch({
      agentRole: "COPYWRITER_AGENT",
      prompt: "Tek cümlelik Türkçe bir sosyal medya kancası yaz.",
    });
    console.log(
      `✅ Yazar (COPYWRITER_AGENT)  : [${writerRes.provider}/${writerRes.modelUsed}] (${writerRes.durationMs}ms) -> "${writerRes.text.trim()}"`
    );

    const validatorRes = await ToprakAiHub.dispatch({
      agentRole: "VALIDATOR_AGENT",
      prompt: `Şu cümleyi tek cümleyle değerlendir: "${writerRes.text.trim()}"`,
    });
    console.log(
      `✅ Denetçi (VALIDATOR_AGENT) : [${validatorRes.provider}/${validatorRes.modelUsed}] (${validatorRes.durationMs}ms) -> "${validatorRes.text.trim()}"`
    );
    return;
  }

  if (command === "bake-topic") {
    const brandIdx = args.indexOf("--brand");
    const brandSlug = brandIdx !== -1 ? args[brandIdx + 1] : "modena";
    const topicIdx = args.indexOf("--topic");
    const customTopic = topicIdx !== -1 ? args[topicIdx + 1] : undefined;

    console.log(`\nMarka: ${brandSlug} için üretim başlatılıyor...`);
    const pkg = await ToprakOrchestrator.bakeFromTrendTopic({
      brandSlug,
      customTopic,
      autoInject: true,
    });
    console.log(`\n🎉 Üretim Tamamlandı ve Social Onayına Bırakıldı!`);
    console.log(`  • Paket ID      : ${pkg.batchId}`);
    console.log(`  • Platformlar   : ${Object.keys(pkg.deliveries).join(", ")}`);
    console.log(`  • Kalite Skoru  : ${pkg.validation.overallScore}/100 (${pkg.validation.status})`);
    console.log(`  • Social PostID : ${pkg.socialHandoff?.postId} (${pkg.socialHandoff?.approvalStatus})`);
    return;
  }

  if (command === "bake-all") {
    const summary = await ToprakOrchestrator.bakeForAllHealthyBrands();
    console.log(
      `\n🌾 Toplu Üretim Özeti: ${summary.succeeded.length}/${summary.totalQualifiedBrands} marka başarıyla Social 'Onay Bekliyor' kuyruğuna gönderildi.`
    );
    for (const f of summary.failed) {
      console.error(`  ❌ ${f.brandSlug}: ${f.error}`);
    }
    return;
  }

  if (command === "bake-video") {
    const brandIdx = args.indexOf("--brand");
    const brandSlug = brandIdx !== -1 ? args[brandIdx + 1] : "modena";
    const inputIdx = args.indexOf("--input");
    const videoPath = inputIdx !== -1 ? args[inputIdx + 1] : undefined;

    if (!videoPath || !fs.existsSync(videoPath)) {
      console.error(`❌ Hata: Geçerli bir video yolu belirtmelisiniz (--input "C:\\video.mp4").`);
      process.exitCode = 1;
      return;
    }

    const pkg = await ToprakOrchestrator.bakeFromRawVideo({
      videoPath,
      brandSlug,
      autoInject: true,
    });
    console.log(`\n🎉 Video Kurgulandı ve Social Onayına Bırakıldı!`);
    console.log(`  • Paket ID      : ${pkg.batchId}`);
    console.log(`  • Social PostID : ${pkg.socialHandoff?.postId} (${pkg.socialHandoff?.approvalStatus})`);
    return;
  }

  if (command === "sync-learning") {
    const results = await LearningEngine.syncAllQualifiedBrands();
    console.log(`✅ ${results.length} sağlıklı marka için Öğrenme Motoru güncellendi.`);
    return;
  }

  console.log(`Bilinmeyen komut: ${command}. Yardım için: npx tsx toprak/cli.ts help`);
}

main().catch((err) => {
  console.error("❌ Toprak CLI hatası:", err instanceof Error ? err.message : err);
  process.exit(1);
});
