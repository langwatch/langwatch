import { join } from "node:path";

import { captureMessage, type Side } from "./capture";
import { DeadlineAlarm } from "./deadline-alarm";
import { fillPath, sideFixtures } from "./flows/context";
import { declinePasskeyOffer } from "./flows/primitives";
import { resolveAction } from "./flows/registry";
import { needsRecapture } from "./module-load";
import { safeName } from "./pairing";
import { note, type CaptureMessage, type Plan, type PlanFlow } from "./protocol";
import { runPoolWithRecapture } from "./schedule";
import { SHELL_PROBE, shellBroken, type ShellProbe } from "./shell";

export type Collect = (message: CaptureMessage) => void;

/** SNAPSHOT_STRIDE keeps one step's mid-action snapshots inside its own index range,
 * so a step that fails on one side cannot shift every capture after it out of line. */
const SNAPSHOT_STRIDE = 100;

/** A capture only asks whether the passkey offer is already up. */
const PASSKEY_CAPTURE_PROBE_MILLIS = 250;

const firstLine = (thrown: unknown): string =>
  String(thrown instanceof Error ? thrown.message : thrown).split("\n")[0] ?? "";

/** photograph declines the passkey offer, which main raises on every screen, then shoots. */
export const photograph = async ({ side, file }: { side: Side; file: string }): Promise<void> => {
  await declinePasskeyOffer({ page: side.page, probeMillis: PASSKEY_CAPTURE_PROBE_MILLIS });
  await side.screenshot(file);
};

/** captureRoute renders one route on one page and reports it. */
const captureRoute = async ({
  plan,
  route,
  side,
  alarm,
}: {
  plan: Plan;
  route: string;
  side: Side;
  alarm: DeadlineAlarm;
}): Promise<CaptureMessage> => {
  const path = fillPath({
    path: route,
    slug: plan.slug,
    fixtures: sideFixtures({ plan, side: side.name }),
  });
  const file = join(plan.outDir, side.name, "routes", `${safeName(path)}.png`);
  const startedAt = Date.now();
  let error = "";
  try {
    await side.goto(path);
    alarm.record(await side.waitUntilQuiet());
    await photograph({ side, file });
  } catch (thrown) {
    error = firstLine(thrown);
  }
  return captureMessage({
    kind: "route",
    key: route,
    index: 0,
    label: route,
    side,
    screenshot: file,
    error,
    durationMs: Date.now() - startedAt,
    notFound: await side.notFound().catch(() => false),
    blank: await side.blank(),
    ariaSnapshot: await side.ariaSnapshot(),
  });
};

/**
 * captureRoutes warms the dev server on the first SHELL_PROBE routes, one at a time (the
 * fail-fast probe), then spreads the rest over the side's pages. A capture the concurrency
 * may have spoiled is held back and taken again alone, once, after the pool.
 */
export const captureRoutes = async ({
  plan,
  pages,
  collect,
}: {
  plan: Plan;
  pages: Side[];
  collect: Collect;
}): Promise<void> => {
  const [first] = pages;
  if (first === undefined) return;
  const alarm = new DeadlineAlarm(first.name);
  const capture = (route: string, side: Side): Promise<CaptureMessage> =>
    captureRoute({ plan, route, side, alarm });
  const probing = plan.failFast === true && first.name === "candidate";
  const probes: ShellProbe[] = [];
  for (const route of plan.routes.slice(0, SHELL_PROBE)) {
    const taken = await capture(route, first);
    const message = needsRecapture(taken) ? await capture(route, first) : taken;
    collect(message);
    if (!probing) continue;
    probes.push({ capture: message, blank: message.blank });
    const broken = shellBroken({ probes });
    if (broken !== "") throw new Error(`the candidate's shell does not render: ${broken}`);
  }
  const heldBack = await runPoolWithRecapture({
    items: plan.routes.slice(SHELL_PROBE),
    width: pages.length,
    take: ({ item, lane }) => capture(item, pages[lane] ?? first),
    spoiled: needsRecapture,
    keep: collect,
  });
  if (heldBack.length > 0) {
    note({
      text: `${first.name} recaptured ${heldBack.length} route(s) alone: ${heldBack.join(", ")}`,
      err: process.stderr,
    });
  }
};

/** captureFlow runs one flow's steps on one page; each step's first action opens its own screen. */
export const captureFlow = async ({
  plan,
  flow,
  side,
  collect,
}: {
  plan: Plan;
  flow: PlanFlow;
  side: Side;
  collect: Collect;
}): Promise<void> => {
  side.drain();
  for (const [stepIndex, step] of flow.steps.entries()) {
    let snapshots = 0;
    const startedAt = Date.now();
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
      await photograph({ side, file }).catch(() => undefined);
      collect(
        captureMessage({
          kind: "flow",
          key: flow.id,
          index,
          label: `${step.action}${label === "" ? "" : `: ${label}`}`,
          side,
          screenshot: file,
          error,
          durationMs: Date.now() - startedAt,
          notFound: false,
          blank: await side.blank(),
          ariaSnapshot: await side.ariaSnapshot(),
        }),
      );
    };

    let error = "";
    try {
      await resolveAction(step.action)({
        side,
        slug: plan.slug,
        credential: plan.credential,
        args: step.with ?? {},
        snapshot: async (label: string) => shoot({ label, error: "" }),
      });
    } catch (thrown) {
      error = step.optional === true ? "" : firstLine(thrown);
    }
    note({
      text: `${side.name} ${flow.id} ${stepIndex} ${step.action} ${error === "" ? "ok" : error}`,
      err: process.stderr,
    });
    await shoot({ label: "after", error });
  }
};
