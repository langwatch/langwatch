import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { nowInstant } from "@langwatch/time";
import lighthouse, { desktopConfig } from "lighthouse";
import { chromium } from "playwright";
import { z } from "zod";

import { CATEGORIES, FORM_FACTORS } from "./budgets.ts";
import { summariseResult } from "./lighthouse-summary.ts";

/* One Lighthouse run per process: Lighthouse keeps per-process state (logging, marks), so the
   parent runs a few of these at once rather than several runs inside one process. */

const options = z.object({
  url: z.url(),
  page: z.string(),
  path: z.string(),
  "form-factor": z.enum(FORM_FACTORS),
  lhr: z.string().optional(),
});

async function devtoolsPort({ userDataDir }: { userDataDir: string }) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const contents = await readFile(path.join(userDataDir, "DevToolsActivePort"), "utf8").catch(
      () => "",
    );
    const port = Number(contents.split("\n")[0]);
    if (port > 0) return port;
    await delay(50);
  }
  throw new Error("Chromium did not publish its DevTools port");
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      page: { type: "string" },
      path: { type: "string" },
      "form-factor": { type: "string" },
      lhr: { type: "string" },
    },
  });
  const args = options.parse(values);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "docs-audit-chromium-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    args: ["--remote-debugging-port=0"],
  });
  const started = nowInstant().epochMilliseconds;
  try {
    const port = await devtoolsPort({ userDataDir });
    const result = await lighthouse(
      args.url,
      { port, output: "json", logLevel: "error", onlyCategories: [...CATEGORIES] },
      args["form-factor"] === "desktop" ? desktopConfig : undefined,
    );
    if (!result) throw new Error(`Lighthouse returned no result for ${args.url}`);
    if (args.lhr) await writeFile(args.lhr, JSON.stringify(result.lhr));
    const run = summariseResult({
      lhr: result.lhr,
      page: args.page,
      pagePath: args.path,
      formFactor: args["form-factor"],
      durationMs: nowInstant().epochMilliseconds - started,
    });
    process.stdout.write(`${JSON.stringify(run)}\n`);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
