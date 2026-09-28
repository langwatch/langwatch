/** @vitest-environment jsdom */
import { appendFileSync } from "node:fs";
import { it } from "vitest";

const targets: [string, () => Promise<unknown>][] = [
  ["chakra", () => import("@chakra-ui/react")],
  ["coding-agent-kit", () => import("@langwatch/coding-agent-browser-kit")],
  ["gateway-contract", () => import("@langwatch/gateway-contract")],
  ["overview", () => import("../ui/sections/personal-workspace/personal-overview.screen.tsx")],
];

it("profiles", async () => {
  for (const [name, load] of targets) {
    const t = performance.now();
    await load();
    appendFileSync("/tmp/merge-test/import-profile.txt", `IMPORT ${name} ${Math.round(performance.now() - t)}ms\n`);
  }
}, 120000);
