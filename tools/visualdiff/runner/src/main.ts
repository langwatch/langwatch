import { readFileSync } from "node:fs";

import { openSideBrowser, type Side, type SideBrowser } from "./capture.ts";
import { keyed, passesFor, passPlan } from "./color-scheme.ts";
import { DiffPool } from "./diff-pool.ts";
import { Pairing, readReplay } from "./pairing.ts";
import { awaitSide } from "./pending-side.ts";
import { emit, note, type Plan, type PlanFlow, type PlanSide } from "./protocol.ts";
import { orderFlows, runPoolWithRecapture, Throttle, width } from "./schedule.ts";
import {
  captureRoutes,
  holdsBack,
  takeFlow,
  type Collect,
  type Lanes,
  type Take,
} from "./screens.ts";
import { signInSide } from "./sign-in.ts";

const out = process.stdout;

/** DIFF_WORKERS decode and compare screenshots beside the pages capturing them. */
const DIFF_WORKERS = 2;

/** WIND_DOWN_MILLIS bounds each step after the last capture, so a stalled one fails loud. */
const WIND_DOWN_MILLIS = 120_000;

/** windDown is `work` unless it outlasts WIND_DOWN_MILLIS, then an error naming `step`. */
const windDown = async <T>({ step, work }: { step: string; work: Promise<T> }): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${step} did not finish within ${WIND_DOWN_MILLIS}ms`)),
      WIND_DOWN_MILLIS,
    );
  });
  try {
    return await Promise.race([work, stalled]);
  } finally {
    clearTimeout(timer);
  }
};

/** exit leaves once stdout has flushed, so no stray handle keeps a finished runner alive. */
const exit = (code: number): void => {
  out.write("", () => process.exit(code));
};

const readPlan = (argv: string[]): Plan => {
  const index = argv.indexOf("--plan");
  if (index === -1 || argv[index + 1] === undefined) {
    throw new Error("usage: capture --plan <plan.json>");
  }
  const plan = JSON.parse(readFileSync(argv[index + 1] as string, "utf8")) as Plan;
  // Go encodes an empty slice as null.
  return { ...plan, routes: plan.routes ?? [], flows: plan.flows ?? [] };
};

/** signInFirst opens a side's first page and signs it in; every lane copies its session. */
const signInFirst = async ({
  plan,
  browser,
  collect,
}: {
  plan: Plan;
  browser: SideBrowser;
  collect: Collect;
}): Promise<Side> => {
  const first = await browser.openPage();
  const startedAt = Date.now();
  await signInSide({ plan, side: first, collect });
  const millis = Date.now() - startedAt;
  emit({ message: { type: "phase", side: first.name, name: "sign-in", millis }, out });
  return first;
};

/**
 * captureSide renders the routes across its lanes, read-only flows taking lanes as the
 * routes drain; then every other flow, on every lane; then the `serial` flows, alone. Each
 * job gets a context of its own, closed after it, so no page lives long enough to bloat.
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
  const first = await signInFirst({ plan, browser, collect });
  const side = first.name;
  const max = Math.max(width(plan.concurrency?.routes), width(plan.concurrency?.flows));
  const lanes: Lanes = {
    open: async (options) => browser.openLane(options),
    width: max,
    throttle: new Throttle(side, max),
  };
  const flows = orderFlows(plan.flows);
  const timings = await captureRoutes({ plan, first, lanes, collect, alongside: flows.readers });
  await first.dispose();
  emit({ message: { type: "phase", side, name: "capture", millis: timings.captureMillis }, out });
  emit({
    message: { type: "phase", side, name: "recapture", millis: timings.recaptureMillis },
    out,
  });
  const flowsStartedAt = Date.now();
  await runPoolWithRecapture<PlanFlow, Take>({
    items: flows.writers,
    width: lanes.width,
    limit: () => lanes.throttle.limit(),
    take: async ({ item }) => takeFlow({ plan, flow: item, lanes, collect }),
    spoiled: (take) => holdsBack({ take, lanes, side }),
    keep: (take) => take.keep(),
  });
  for (const flow of flows.last) {
    (await takeFlow({ plan, flow, lanes, collect })).keep();
  }
  emit({
    message: { type: "phase", side, name: "flows", millis: Date.now() - flowsStartedAt },
    out,
  });
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
        // One pass per scheme, each in a browser of its own, so no pass sees the other's session.
        for (const scheme of passesFor(plan.colorScheme)) {
          const browser = await openSideBrowser({
            side: definition,
            viewport: plan.viewport,
            settle: plan.settle,
            frozenTime: plan.frozenTime,
            fast: plan.fast,
            colorScheme: scheme,
          });
          browsers.push(browser);
          try {
            await captureSide({
              plan: passPlan({ plan, scheme }),
              browser,
              collect: keyed({ collect, plan, scheme }),
            });
          } finally {
            await windDown({
              step: `closing the ${definition.name} browser`,
              work: browser.close(),
            });
          }
        }
      }),
    );
    await windDown({ step: "comparing the screenshots", work: Promise.all(diffs) });
  } finally {
    await windDown({
      step: "closing the browsers",
      work: Promise.all(browsers.map((browser) => browser.close())),
    });
    await windDown({ step: "stopping the diff workers", work: differ.close() });
  }
  emit({ message: { type: "done" }, out });
};

main()
  .then(() => exit(0))
  .catch((thrown: unknown) => {
    emit({
      message: {
        type: "error",
        message: String(thrown instanceof Error ? thrown.message : thrown),
      },
      out,
    });
    exit(1);
  });
