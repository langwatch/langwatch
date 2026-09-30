import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { openSideBrowser, type SideBrowser } from "@langwatch/visual-diff-runner/capture";
import { signIn } from "@langwatch/visual-diff-runner/flows/actions";
import { declinePasskeyOffer } from "@langwatch/visual-diff-runner/flows/primitives";
import type { PlanFlow } from "@langwatch/visual-diff-runner/protocol";

import { flowFile, journeyFlow } from "./flows.ts";
import type { JevConfig } from "./jev.ts";
import { Ledger } from "./ledger.ts";
import { mapSchema, mergeMaps, renderMap, type ProductMap } from "./map.ts";
import {
  features,
  pickFeatures,
  planJourneys,
  scenarios,
  visualdiffConfig,
  type Feature,
  type Journey,
} from "./plan.ts";
import { SIMULATOR, seedSimulator } from "./seed.ts";
import type { SonnetConfig } from "./sonnet.ts";
import { JourneyWalk, type Walk, type Walked } from "./walk.ts";

export interface RunOptions {
  root: string;
  url: string;
  keys: { sonnet: SonnetConfig; jev: JevConfig };
  features: string[];
  journeys: number;
  pages: number;
  steps: number;
  budgetUsd: number;
  minutes: number;
}

interface Planned {
  feature: Feature;
  journey: Journey;
  /** index numbers the run's journeys, so each one's `{uid}` is its own. */
  index: number;
}

/** Outcome is what a run's walks found: the map's new results and the flows they completed. */
interface Outcome {
  results: ProductMap;
  flows: Map<string, PlanFlow[]>;
}

const message = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

const runStamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/** signInOnce signs the browser's shared context in, so every page after it is the simulator. */
const signInOnce = async ({
  browser,
  slug,
}: {
  browser: SideBrowser;
  slug: string;
}): Promise<void> => {
  const side = await browser.openPage();
  const credential = { projectKey: "", email: SIMULATOR.email, password: SIMULATOR.password, slug };
  await signIn({ side, slug, credential, args: {}, values: {}, snapshot: async () => undefined });
  await side.waitUntilQuiet();
  await declinePasskeyOffer({ page: side.page, probeMillis: 2_000 });
  const path = new URL(side.page.url()).pathname;
  await side.dispose();
  if (path.startsWith("/auth/"))
    throw new Error(`the simulator is still on ${path} after signing in`);
};

/** walkAll walks the queue over `pages` pages of one signed-in browser. */
const walkAll = async ({
  browser,
  queue,
  pages,
  walkOf,
  outcome,
}: {
  browser: SideBrowser;
  queue: Planned[];
  pages: number;
  walkOf: (side: Walk["side"]) => Walk;
  outcome: Outcome;
}): Promise<void> => {
  const worker = async (): Promise<void> => {
    const side = await browser.openPage();
    const walk = walkOf(side);
    try {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        const { feature, journey, index } = item;
        const uid = `${walk.runId.replaceAll("-", "")}${index}`;
        const walked: Walked = await new JourneyWalk(walk, feature, journey, uid)
          .run()
          .catch((thrown: unknown) => ({
            result: {
              goal: journey.goal,
              status: "untested",
              reason: `the walk failed: ${message(thrown)}`,
              run: walk.runId,
              evidence: { screens: [], held: [], failing: [] },
            },
            steps: [],
          }));
        outcome.results.features[feature.id] = {
          ...outcome.results.features[feature.id],
          [journey.id]: walked.result,
        };
        process.stderr.write(
          `${feature.id}/${journey.id}: ${walked.result.status}: ${walked.result.reason}\n`,
        );
        if (walked.result.status !== "works") continue;
        const flow = journeyFlow({ feature: feature.id, journey, steps: walked.steps });
        outcome.flows.set(feature.id, [...(outcome.flows.get(feature.id) ?? []), flow]);
      }
    } finally {
      await side.dispose();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, pages) }, worker));
};

/** writeOutputs merges the run into the map so far and writes map, flows and the timing block. */
const writeOutputs = ({
  home,
  out,
  outcome,
  ledger,
  featureIds,
}: {
  home: string;
  out: string;
  outcome: Outcome;
  ledger: Ledger;
  featureIds: string[];
}): void => {
  const mapFile = join(home, "map.json");
  const previous = existsSync(mapFile)
    ? mapSchema.parse(JSON.parse(readFileSync(mapFile, "utf8")))
    : { url: outcome.results.url, features: {} };
  const merged = mergeMaps({ previous, next: outcome.results });
  for (const file of [mapFile, join(out, "map.json")])
    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  writeFileSync(join(out, "map.md"), renderMap({ map: merged, featureIds }));
  mkdirSync(join(out, "flows"), { recursive: true });
  for (const [feature, flows] of outcome.flows) {
    writeFileSync(join(out, "flows", `${feature}.yaml`), flowFile({ feature, flows }));
  }
  writeFileSync(join(out, "timing.md"), ledger.block());
};

/**
 * runSimulation seeds the simulator's org, signs in, has Sonnet plan each
 * feature's journeys, walks them over `pages` pages and writes the outputs.
 */
export const runSimulation = async (
  options: RunOptions,
): Promise<{ out: string; findings: number; flows: number }> => {
  const runId = runStamp();
  const home = join(options.root, ".interactionsimulator");
  const out = join(home, runId);
  mkdirSync(out, { recursive: true });
  const ledger = new Ledger();
  const deadline = Date.now() + options.minutes * 60_000;
  const capReached = (): string => {
    if (ledger.usd >= options.budgetUsd) return `the $${options.budgetUsd} budget was spent`;
    return Date.now() > deadline ? `the ${options.minutes}-minute cap was reached` : "";
  };
  const catalogue = features({ root: options.root });
  const picked =
    options.features.length === 0
      ? catalogue
      : pickFeatures({ all: catalogue, names: options.features });
  const visualdiff = visualdiffConfig({ root: options.root });
  const { slug } = await ledger.phase({
    name: "seed",
    work: () => seedSimulator({ url: options.url, dir: home }),
  });
  const browser = await openSideBrowser({
    side: { name: "simulator", baseUrl: options.url },
    viewport: { width: 1440, height: 900 },
    settle: visualdiff.settle,
  });
  const outcome: Outcome = { results: { url: options.url, features: {} }, flows: new Map() };
  try {
    await ledger.phase({ name: "sign-in", work: () => signInOnce({ browser, slug }) });
    const planned = await ledger.phase({
      name: "plan",
      work: () =>
        Promise.all(
          picked.map((feature) =>
            planJourneys({
              config: options.keys.sonnet,
              ledger,
              feature,
              limit: options.journeys,
              routes: visualdiff.routes,
              featureScenarios: scenarios({ root: options.root, feature }),
            }).then(
              (journeys) => journeys.map((journey) => ({ feature, journey })),
              (thrown: unknown) => {
                process.stderr.write(`plan ${feature.id}: ${message(thrown)}\n`);
                return [];
              },
            ),
          ),
        ),
    });
    const walkOf = (side: Walk["side"]): Walk => ({
      side,
      slug,
      runId,
      out,
      ledger,
      sonnet: options.keys.sonnet,
      jev: options.keys.jev,
      maxSteps: options.steps,
      capReached,
    });
    await ledger.phase({
      name: "journeys",
      work: () => {
        const queue = planned.flat().map((item, index) => ({ ...item, index }));
        return walkAll({ browser, queue, pages: options.pages, walkOf, outcome });
      },
    });
  } finally {
    await browser.close();
  }
  writeOutputs({ home, out, outcome, ledger, featureIds: catalogue.map((feature) => feature.id) });
  const results = Object.values(outcome.results.features).flatMap((journeys) =>
    Object.values(journeys),
  );
  return {
    out,
    findings: results.filter((result) => result.status === "broken").length,
    flows: [...outcome.flows.values()].flat().length,
  };
};
