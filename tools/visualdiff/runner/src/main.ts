import { readFileSync } from "node:fs";

import { openSideBrowser, type Side, type SideBrowser } from "./capture";
import { DiffPool } from "./diff-pool";
import { Pairing, readReplay } from "./pairing";
import { awaitSide } from "./pending-side";
import { emit, note, type Plan, type PlanSide } from "./protocol";
import { orderFlows, runPool, width } from "./schedule";
import { captureFlow, captureRoutes, type Collect } from "./screens";
import { signInSide } from "./sign-in";

const out = process.stdout;

/** DIFF_WORKERS decode and compare screenshots beside the pages capturing them. */
const DIFF_WORKERS = 2;

const readPlan = (argv: string[]): Plan => {
  const index = argv.indexOf("--plan");
  if (index === -1 || argv[index + 1] === undefined) {
    throw new Error("usage: capture --plan <plan.json>");
  }
  return JSON.parse(readFileSync(argv[index + 1] as string, "utf8")) as Plan;
};

/** openPages launches a side, signs its first page in, and opens the rest in the same session. */
const openPages = async ({
  plan,
  browser,
  collect,
}: {
  plan: Plan;
  browser: SideBrowser;
  collect: Collect;
}): Promise<Side[]> => {
  const first = await browser.openPage();
  const count = Math.max(width(plan.concurrency?.routes), width(plan.concurrency?.flows));
  const [, rest] = await Promise.all([
    signInSide({ plan, side: first, collect }),
    Promise.all(Array.from({ length: count - 1 }, () => browser.openPage())),
  ]);
  return [first, ...rest];
};

/**
 * captureSide renders the routes across its pages, read-only flows taking pages as the
 * routes drain; then the flows that write, on every page; then the view and project
 * edits, alone.
 */
const captureSide = async ({
  plan,
  browser,
  collect,
}: {
  plan: Plan;
  browser: SideBrowser;
  collect: Collect;
}): Promise<void> => {
  const pages = await openPages({ plan, browser, collect });
  const [first] = pages;
  if (first === undefined) return;
  const flows = orderFlows(plan.flows);
  await captureRoutes({ plan, pages, collect, alongside: flows.readers });
  await runPool({
    items: flows.writers,
    width: pages.length,
    work: async ({ item, lane }) =>
      captureFlow({ plan, flow: item, side: pages[lane] ?? first, collect }),
  });
  for (const flow of flows.last) {
    await captureFlow({ plan, flow, side: first, collect });
  }
};

const main = async (): Promise<void> => {
  const plan = readPlan(process.argv.slice(2));
  emit({ message: { type: "ready" }, out });
  const differ = new DiffPool(DIFF_WORKERS);
  const pairing = new Pairing(plan, async (files) => differ.diff(files));
  const diffs: Promise<void>[] = [];
  const collect: Collect = (message) => {
    emit({ message, out });
    diffs.push(
      pairing.add(message).then(
        (diff) => {
          if (diff !== null) emit({ message: diff, out });
        },
        (thrown: unknown) =>
          note({ text: `diff ${message.key}: ${String(thrown)}`, err: process.stderr }),
      ),
    );
  };
  for (const definition of plan.sides) {
    if (definition.replay === undefined) continue;
    for (const message of readReplay({ file: definition.replay, plan, side: definition.name })) {
      collect(message);
    }
  }
  const live = plan.sides.filter((definition: PlanSide) => definition.replay === undefined);
  const browsers: SideBrowser[] = [];
  try {
    // Both sides sign in and capture at once; one failing closes the other.
    await Promise.all(
      live.map(async (waiting) => {
        const definition = await awaitSide(waiting);
        plan.sides = plan.sides.map((side) => (side.name === definition.name ? definition : side));
        const browser = await openSideBrowser({
          side: definition,
          viewport: plan.viewport,
          settle: plan.settle,
          frozenTime: plan.frozenTime,
        });
        browsers.push(browser);
        try {
          await captureSide({ plan, browser, collect });
        } finally {
          await browser.close();
        }
      }),
    );
    await Promise.all(diffs);
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
    await differ.close();
  }
  emit({ message: { type: "done" }, out });
};

main().catch((thrown: unknown) => {
  emit({
    message: { type: "error", message: String(thrown instanceof Error ? thrown.message : thrown) },
    out,
  });
  process.exitCode = 1;
});
