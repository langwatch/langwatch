/**
 * Screenshots the mail room's chrome with the kit's helper. Start the studio
 * first (`pnpm --filter @langwatch/mail dev`), then run this with an optional
 * base URL. PNGs land in `.claude/tmp/screens/mailroom/` at the repository root.
 */
import { resolve } from "node:path";

import { captureScreens } from "@langwatch/design-system-internal/screenshot";

const baseUrl = process.argv[2] ?? "http://localhost:5566";
const outDir = resolve(import.meta.dirname, "../../../.claude/tmp/screens/mailroom");

type Ready = { page: { waitForSelector: (selector: string) => Promise<unknown> } };
const framesReady = async ({ page }: Ready) => {
  await page.waitForSelector("iframe");
  await new Promise((settle) => setTimeout(settle, 800));
};

const written = await captureScreens({
  baseUrl,
  outDir,
  views: [
    { name: "inspect", path: "/?view=inspect", prepare: framesReady },
    {
      name: "inspect-text",
      path: "/?view=inspect",
      prepare: async ({ page }) => {
        await page.getByText("Text", { exact: true }).click();
        await page.waitForSelector(".ds-codeblock, pre");
      },
    },
    {
      name: "inspect-focus",
      path: "/?view=inspect",
      viewportOnly: true,
      prepare: async ({ page }) => {
        await framesReady({ page });
        await page.keyboard.press("Tab");
      },
    },
    { name: "gallery", path: "/?view=gallery", prepare: framesReady },
    {
      name: "gallery-compact",
      path: "/?view=gallery&density=compact&fixtures=all&width=mobile",
      prepare: framesReady,
    },
  ],
});
process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
