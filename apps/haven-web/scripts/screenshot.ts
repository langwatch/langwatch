/**
 * Screenshots every haven view from the built bundle (`pnpm --filter
 * @langwatch/haven-web build` first) against the fixture daemon, at 1280 and
 * 390 wide, light and dark, into `.claude/tmp/screens/haven-web/`.
 */
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { captureScreens, type ScreenView } from "@langwatch/design-system-internal/screenshot";

import { startFixtureDaemon } from "./fixture-daemon.ts";

const root = resolve(import.meta.dirname, "../../..");
const dist = resolve(root, "tools/thuishaven/adapters/dashboard/web/dist");
const outDir = resolve(root, ".claude/tmp/screens/haven-web");

await access(resolve(dist, "index.html")).catch(() => {
  throw new Error(`No bundle in ${dist}: run pnpm --filter @langwatch/haven-web build first.`);
});

const daemon = await startFixtureDaemon({ dist });
const at = ({ host, path = "/" }: { host: string; path?: string }) =>
  `http://${host}.langwatch.localhost:${daemon.port}${path}`;

const views: ScreenView[] = [
  { name: "hub", path: at({ host: "hub" }) },
  { name: "hub-logs", path: at({ host: "hub", path: "/logs/feat-x" }), viewportOnly: true },
  {
    name: "hub-logs-filtered",
    path: at({ host: "hub", path: "/logs/feat-x/api" }),
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("checkbox", { name: /info/ }).uncheck();
      await page.getByRole("searchbox", { name: "Filter" }).fill("request");
    },
  },
  { name: "home", path: at({ host: "feat-x" }) },
  {
    name: "home-armed",
    path: at({ host: "feat-x" }),
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("button", { name: "Restart" }).click();
    },
  },
  {
    name: "home-focus",
    path: at({ host: "feat-x" }),
    viewportOnly: true,
    prepare: async ({ page }) => {
      await page.getByRole("heading", { name: "Surfaces" }).click();
      await page.keyboard.press("Tab");
    },
  },
  { name: "home-stopped", path: at({ host: "stopped" }) },
  { name: "home-unknown", path: at({ host: "nope" }) },
];

try {
  const written = await captureScreens({ baseUrl: at({ host: "hub" }), views, outDir });
  process.stdout.write(`${written.length} screenshots in ${outDir}\n`);
} finally {
  await daemon.close();
}
