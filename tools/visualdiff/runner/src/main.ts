import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openSide, captureMessage, type Side } from "./capture";
import { diffScreenshots } from "./diff";
import { resolveAction } from "./flows/registry";
import { fillPath } from "./flows/context";
import { emit, note, type CaptureMessage, type Plan, type PlanFlow } from "./protocol";

const out = process.stdout;
const err = process.stderr;

const readPlan = (argv: string[]): Plan => {
  const index = argv.indexOf("--plan");
  if (index === -1 || argv[index + 1] === undefined) {
    throw new Error("usage: capture --plan <plan.json>");
  }
  return JSON.parse(readFileSync(argv[index + 1] as string, "utf8")) as Plan;
};

const safeName = (value: string): string =>
  value === "/" ? "_root" : value.replace(/^\//, "").replace(/[/?=&{}]/g, "_");

/** SNAPSHOT_STRIDE keeps one step's mid-action snapshots inside its own index range,
 * so a step that fails on one side cannot shift every capture after it out of line. */
const SNAPSHOT_STRIDE = 100;

const captureRoutes = async ({
  plan,
  side,
  collected,
}: {
  plan: Plan;
  side: Side;
  collected: CaptureMessage[];
}): Promise<void> => {
  for (const route of plan.routes) {
    const path = fillPath({ path: route, slug: plan.slug });
    const file = join(plan.outDir, side.name, "routes", `${safeName(path)}.png`);
    const startedAt = Date.now();
    let error = "";
    try {
      await side.page.goto(side.baseUrl + path, { waitUntil: "commit", timeout: 20_000 });
      await side.waitUntilQuiet();
      await side.screenshot(file);
    } catch (thrown) {
      error = String(thrown instanceof Error ? thrown.message : thrown).split("\n")[0] ?? "";
    }
    const message = captureMessage({
      kind: "route",
      key: route,
      index: 0,
      label: route,
      side,
      screenshot: file,
      error,
      durationMs: Date.now() - startedAt,
      notFound: await side.notFound().catch(() => false),
    });
    collected.push(message);
    emit({ message, out });
  }
};

const captureFlow = async ({
  plan,
  flow,
  side,
  collected,
}: {
  plan: Plan;
  flow: PlanFlow;
  side: Side;
  collected: CaptureMessage[];
}): Promise<void> => {
  await side.page
    .goto(`${side.baseUrl}/${plan.slug}`, { waitUntil: "commit" })
    .catch(() => undefined);
  await side.waitUntilQuiet();
  side.drain();

  for (const [stepIndex, step] of flow.steps.entries()) {
    let snapshots = 0;
    const shoot = async ({ label, error }: { label: string; error: string }): Promise<void> => {
      const index = stepIndex * SNAPSHOT_STRIDE + snapshots;
      snapshots += 1;
      const file = join(
        plan.outDir,
        side.name,
        "flows",
        flow.id,
        `${String(index).padStart(4, "0")}.png`,
      );
      await side.waitUntilQuiet();
      await side.screenshot(file).catch(() => undefined);
      const message = captureMessage({
        kind: "flow",
        key: flow.id,
        index,
        label: `${step.action}${label === "" ? "" : `: ${label}`}`,
        side,
        screenshot: file,
        error,
        durationMs: 0,
        notFound: false,
      });
      collected.push(message);
      emit({ message, out });
    };

    const startedAt = Date.now();
    let error = "";
    try {
      const action = resolveAction(step.action);
      await action({
        side,
        slug: plan.slug,
        credential: plan.credential,
        args: step.with ?? {},
        snapshot: async (label: string) => shoot({ label, error: "" }),
      });
    } catch (thrown) {
      error = String(thrown instanceof Error ? thrown.message : thrown).split("\n")[0] ?? "";
      if (step.optional === true) error = "";
    }
    note({
      text: `${side.name} ${flow.id} ${stepIndex} ${step.action} ${error === "" ? "ok" : error}`,
      err,
    });
    await shoot({ label: `after ${Date.now() - startedAt}ms`, error });
  }
};

const captureSide = async ({
  plan,
  sideIndex,
}: {
  plan: Plan;
  sideIndex: number;
}): Promise<CaptureMessage[]> => {
  const definition = plan.sides[sideIndex];
  if (definition === undefined) throw new Error(`no side ${sideIndex} in the plan`);
  const side = await openSide({ side: definition, viewport: plan.viewport, settle: plan.settle });
  const collected: CaptureMessage[] = [];
  try {
    await captureRoutes({ plan, side, collected });
    for (const flow of plan.flows) {
      await captureFlow({ plan, flow, side, collected });
    }
  } finally {
    await side.browser.close().catch(() => undefined);
  }
  return collected;
};

/** emitDiffs pairs the two sides' captures and diffs each pair's screenshots. */
const emitDiffs = ({
  plan,
  base,
  candidate,
}: {
  plan: Plan;
  base: CaptureMessage[];
  candidate: CaptureMessage[];
}): void => {
  const identity = (capture: CaptureMessage): string =>
    `${capture.kind}|${capture.key}|${capture.index}`;
  const byIdentity = new Map(base.map((capture) => [identity(capture), capture]));
  for (const right of candidate) {
    const left = byIdentity.get(identity(right));
    if (left === undefined) continue;
    const file = join(
      plan.outDir,
      "diff",
      `${safeName(right.kind)}_${safeName(right.key)}_${right.index}.png`,
    );
    const diff = diffScreenshots({ base: left.screenshot, candidate: right.screenshot, out: file });
    if (diff === null) continue;
    emit({
      message: {
        type: "diff",
        kind: right.kind,
        key: right.key,
        index: right.index,
        ratio: diff.ratio,
        file,
      },
      out,
    });
  }
};

const main = async (): Promise<void> => {
  const plan = readPlan(process.argv.slice(2));
  emit({ message: { type: "ready" }, out });
  const captured: CaptureMessage[][] = [];
  for (const sideIndex of plan.sides.keys()) {
    captured.push(await captureSide({ plan, sideIndex }));
  }
  emitDiffs({ plan, base: captured[0] ?? [], candidate: captured[1] ?? [] });
  emit({ message: { type: "done" }, out });
};

main().catch((thrown: unknown) => {
  emit({
    message: { type: "error", message: String(thrown instanceof Error ? thrown.message : thrown) },
    out,
  });
  process.exitCode = 1;
});
