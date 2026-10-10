/**
 * Screenshots the manager's paper theme with the kit's helper. Start Storybook
 * first, then pass its URL; PNGs land in `.claude/tmp/screens/storybook/`.
 */
import { resolve } from "node:path";

import { captureScreens } from "@langwatch/design-system-internal/screenshot";

const baseUrl = process.argv[2] ?? "http://localhost:6006";
const outDir = resolve(import.meta.dirname, "../../../.claude/tmp/screens/storybook");

const written = await captureScreens({
  baseUrl,
  outDir,
  views: [
    {
      name: "manager",
      path: "/",
      viewportOnly: true,
      prepare: async ({ page }) => {
        await page.getByText("LangWatch design system").first().waitFor();
        await new Promise((settle) => setTimeout(settle, 1500));
      },
    },
  ],
});
process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
