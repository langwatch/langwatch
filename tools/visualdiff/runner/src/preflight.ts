import { chromium } from "playwright";

try {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  await browser.close();
} catch (thrown) {
  const reason = thrown instanceof Error ? thrown.message : String(thrown);
  process.stderr.write(
    `visualdiff runner cannot launch chromium: ${reason}\nFix: (cd tools/visualdiff/runner && pnpm exec playwright install chromium)\n`,
  );
  process.exit(1);
}
