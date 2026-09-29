import { join } from "node:path";

import { captureMessage, type Side } from "./capture";
import { DeadlineAlarm } from "./deadline-alarm";
import { fillPath, sideFixtures } from "./flows/context";
import { fillArgs, flowValues, ISOLATED_KEY, ISOLATED_SLUG, uidFor } from "./flows/values";
import { describeExpect } from "./flows/expect";
import { declinePasskeyOffer } from "./flows/primitives";
import { resolveAction } from "./flows/registry";
import { needsRecapture } from "./module-load";
import { safeName } from "./pairing";
import {
  emit,
  note,
  type CaptureMessage,
  type Credential,
  type Plan,
  type PlanFlow,
} from "./protocol";
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

/** ANSI_ESCAPE matches the terminal colours Playwright writes into its call log. */
// oxlint-disable-next-line no-control-regex -- the escape character is what this matches.
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/** CALL_LOG_LINES caps how much of Playwright's call log a failed step keeps. */
const CALL_LOG_LINES = 20;

/**
 * stepError is a failed step's first line plus Playwright's call log (what the locator
 * resolved to, the element's state, what intercepted the click), repeats dropped, on one line.
 */
export const stepError = (thrown: unknown): string => {
  const text = String(thrown instanceof Error ? thrown.message : thrown);
  const lines = text.replaceAll(ANSI_ESCAPE, "").split("\n");
  const start = lines.findIndex((line) => line.trim() === "Call log:");
  if (start < 0) return lines[0] ?? "";
  const log: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const entry = line.trim().replace(/^- /, "");
    if (entry === "" || log.includes(entry)) continue;
    log.push(entry);
  }
  return [lines[0] ?? "", ...log.slice(0, CALL_LOG_LINES)].join(" | ");
};

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

/** probeShell takes the first routes one at a time; a candidate whose shell fails stops. */
const probeShell = async ({
  plan,
  capture,
  collect,
  side,
}: {
  plan: Plan;
  capture: (route: string) => Promise<CaptureMessage>;
  collect: Collect;
  side: Side;
}): Promise<void> => {
  const probing = plan.failFast === true && side.name === "candidate";
  const probes: ShellProbe[] = [];
  for (const route of plan.routes.slice(0, SHELL_PROBE)) {
    const taken = await capture(route);
    const message = needsRecapture(taken) ? await capture(route) : taken;
    collect(message);
    if (!probing) continue;
    probes.push({ capture: message, blank: message.blank });
    const broken = shellBroken({ probes });
    if (broken !== "") throw new Error(`the candidate's shell does not render: ${broken}`);
  }
};

/** RouteJob is one item of a side's route pool: a route, or a read-only flow once routes drain. */
type RouteJob = { route: string } | { flow: PlanFlow };

/** RouteTimings split a side's route pass into its pooled capture and its retakes alone. */
export interface RouteTimings {
  captureMillis: number;
  recaptureMillis: number;
}

/**
 * captureRoutes takes the first SHELL_PROBE routes one at a time (the fail-fast probe), then
 * spreads the rest over the side's pages, each taking an `alongside` flow once no route is
 * left. A capture the concurrency may have spoiled is taken again alone, after the pool.
 */
export const captureRoutes = async ({
  plan,
  pages,
  collect,
  alongside = [],
}: {
  plan: Plan;
  pages: Side[];
  collect: Collect;
  alongside?: PlanFlow[];
}): Promise<RouteTimings> => {
  const startedAt = Date.now();
  let recaptureMillis = 0;
  const [first] = pages;
  if (first === undefined) return { captureMillis: 0, recaptureMillis };
  const alarm = new DeadlineAlarm(first.name);
  const capture = (route: string, side: Side): Promise<CaptureMessage> =>
    captureRoute({ plan, route, side, alarm });
  await probeShell({ plan, capture: (route) => capture(route, first), collect, side: first });
  const jobs: RouteJob[] = [
    ...plan.routes.slice(SHELL_PROBE).map((route) => ({ route })),
    ...alongside.map((flow) => ({ flow })),
  ];
  const heldBack = await runPoolWithRecapture<RouteJob, CaptureMessage | undefined>({
    items: jobs,
    width: pages.length,
    take: async ({ item, lane }) => {
      const side = pages[lane] ?? first;
      if ("route" in item) return capture(item.route, side);
      await captureFlow({ plan, flow: item.flow, side, collect });
      return undefined;
    },
    spoiled: (message) => {
      if (message === undefined || !needsRecapture(message)) return false;
      const why = message.blank ? "blank" : (message.moduleFailures?.[0] ?? "");
      note({ text: `${first.name} holds back ${message.key}: ${why}`, err: process.stderr });
      return true;
    },
    keep: (message) => {
      if (message !== undefined) collect(message);
    },
    onRecaptured: (millis) => {
      recaptureMillis = millis;
    },
  });
  if (heldBack.length > 0) {
    const routes = heldBack.map((job) => ("route" in job ? job.route : job.flow.id));
    note({
      text: `${first.name} recaptured ${heldBack.length} route(s) alone: ${routes.join(", ")}`,
      err: process.stderr,
    });
  }
  return { captureMillis: Date.now() - startedAt - recaptureMillis, recaptureMillis };
};

/** FlowProject is the project a flow works in, and why it cannot when it has none. */
interface FlowProject {
  slug: string;
  credential: Credential;
  missing: string;
}

/** flowProject is the plan's project, or the seeded second one for an `isolated` flow. */
export const flowProject = ({
  plan,
  flow,
  fixtures,
}: {
  plan: Pick<Plan, "slug" | "credential">;
  flow: PlanFlow;
  fixtures: Record<string, string>;
}): FlowProject => {
  if (flow.isolated !== true) return { slug: plan.slug, credential: plan.credential, missing: "" };
  const slug = fixtures[ISOLATED_SLUG];
  const projectKey = fixtures[ISOLATED_KEY];
  if (slug === undefined || projectKey === undefined) {
    return { slug: plan.slug, credential: plan.credential, missing: "this side seeded no isolated project" };
  }
  return { slug, credential: { ...plan.credential, slug, projectKey }, missing: "" };
};

/**
 * captureFlow runs one flow's steps on one page, each step's first action opening its own
 * screen, and stops at the first step that fails. Check mode photographs only expects and the failure.
 */
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
  const flowStartedAt = Date.now();
  const everyStep = plan.check !== true;
  let failed = 0;
  const fixtures = sideFixtures({ plan, side: side.name });
  const project = flowProject({ plan, flow, fixtures });
  const values: Record<string, string> = {
    ...fixtures,
    ...flowValues({ fixtures, flowId: flow.id }),
    slug: project.slug,
    uid: uidFor(flow.id),
  };
  const mailUrl = plan.sides.find((candidate) => candidate.name === side.name)?.mailUrl;
  let anonymous: Side | undefined;
  for (const [stepIndex, step] of flow.steps.entries()) {
    let snapshots = 0;
    let active = side;
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
      await active.waitUntilQuiet();
      await photograph({ side: active, file }).catch(() => undefined);
      collect(
        captureMessage({
          kind: "flow",
          key: flow.id,
          index,
          label: `${step.action}${label === "" ? "" : `: ${label}`}`,
          side: active,
          screenshot: file,
          error,
          durationMs: Date.now() - startedAt,
          notFound: false,
          blank: await active.blank(),
          ariaSnapshot: await active.ariaSnapshot(),
          expect: step.action === "expect" ? describeExpect(step.with ?? {}) : undefined,
        }),
      );
    };

    let error = "";
    try {
      if (project.missing !== "") throw new Error(project.missing);
      if (step.with?.anonymous === "true") {
        anonymous ??= await side.openAnonymous();
        active = anonymous;
      }
      await resolveAction(step.action)({
        side: active,
        slug: project.slug,
        credential: project.credential,
        args: fillArgs({ args: step.with ?? {}, values }),
        values,
        mailUrl,
        snapshot: async (label: string) => (everyStep ? shoot({ label, error: "" }) : undefined),
      });
    } catch (thrown) {
      error = step.optional === true ? "" : stepError(thrown);
    }
    if (error !== "") {
      failed += 1;
      note({
        text: `${side.name} ${flow.id} ${stepIndex} ${step.action} ${error}`,
        err: process.stderr,
      });
    }
    // Check mode still settles after every step: the next step's 6s starts on a loaded screen.
    if (everyStep || error !== "" || step.action === "expect") await shoot({ label: "after", error });
    else await active.waitUntilQuiet();
    if (error !== "") break;
  }
  await anonymous?.dispose();
  if (!everyStep) {
    const millis = Date.now() - flowStartedAt;
    emit({ message: { type: "phase", side: side.name, name: `flow ${flow.id}`, millis }, out: process.stdout });
  }
  const outcome = failed === 0 ? "ok" : `${failed} failed`;
  note({
    text: `${side.name} ${flow.id}: ${flow.steps.length} steps, ${outcome}`,
    err: process.stderr,
  });
};
