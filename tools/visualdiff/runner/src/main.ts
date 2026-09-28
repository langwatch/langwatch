import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openSide, captureMessage, type Side } from "./capture";
import { diffScreenshots } from "./diff";
import { signIn } from "./flows/actions";
import { fillPath, sideFixtures } from "./flows/context";
import { declinePasskeyOffer } from "./flows/primitives";
import { resolveAction } from "./flows/registry";
import { Pairing, readReplay, safeName } from "./pairing";
import {
  emit,
  note,
  type CaptureMessage,
  type Plan,
  type PlanFlow,
  type PlanSide,
} from "./protocol";
import { shellBroken, type ShellProbe } from "./shell";

const out = process.stdout;
const err = process.stderr;

const readPlan = (argv: string[]): Plan => {
  const index = argv.indexOf("--plan");
  if (index === -1 || argv[index + 1] === undefined) {
    throw new Error("usage: capture --plan <plan.json>");
  }
  return JSON.parse(readFileSync(argv[index + 1] as string, "utf8")) as Plan;
};

type Collect = (message: CaptureMessage) => void;

/** SNAPSHOT_STRIDE keeps one step's mid-action snapshots inside its own index range,
 * so a step that fails on one side cannot shift every capture after it out of line. */
const SNAPSHOT_STRIDE = 100;

const captureRoutes = async ({
  plan,
  side,
  collect,
}: {
  plan: Plan;
  side: Side;
  collect: Collect;
}): Promise<void> => {
  const probes: ShellProbe[] = [];
  const probing = plan.failFast === true && side.name === "candidate";
  const fixtures = sideFixtures({ plan, side: side.name });
  for (const route of plan.routes) {
    const path = fillPath({ path: route, slug: plan.slug, fixtures });
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
      blank: await side.blank(),
      ariaSnapshot: await side.ariaSnapshot(),
    });
    collect(message);
    if (!probing) continue;
    probes.push({ capture: message, blank: message.blank });
    const broken = shellBroken({ probes });
    if (broken !== "") throw new Error(`the candidate's shell does not render: ${broken}`);
  }
};

const captureFlow = async ({
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
        blank: await side.blank(),
        ariaSnapshot: await side.ariaSnapshot(),
      });
      collect(message);
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

/** signInSide signs in before any route, so routes photograph the product, not the sign-in page. */
const signInSide = async ({ plan, side }: { plan: Plan; side: Side }): Promise<void> => {
  if (plan.credential.email === "") return;
  const emails = [plan.credential.email, ...(plan.credential.fallbackEmails ?? [])];
  const failures: string[] = [];
  for (const email of emails) {
    const failure = await signIn({
      side,
      slug: plan.slug,
      credential: { ...plan.credential, email },
      args: {},
      snapshot: async () => undefined,
    }).then(
      () => "",
      (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown)),
    );
    await side.waitUntilQuiet();
    if (failure === "" && !new URL(side.page.url()).pathname.startsWith("/auth/")) {
      await declinePasskeyOffer(side.page);
      await side.waitUntilQuiet();
      side.drain();
      return;
    }
    failures.push(`${email}: ${failure === "" ? "still on an /auth/ page" : failure}`);
  }
  const page = (await side.ariaSnapshot())
    .replaceAll(/(textbox "[^"]*"): .*/g, "$1: <typed>")
    .replaceAll("\n", " | ")
    .slice(0, 1500);
  throw new Error(
    `${side.name} could not sign in (${failures.join("; ")}) at ${side.page.url()}; page: ${page}`,
  );
};

/** openSignedIn opens a live side and signs it in; every side does this before any capture. */
const openSignedIn = async ({ plan, definition }: { plan: Plan; definition: PlanSide }) => {
  const side = await openSide({
    side: definition,
    viewport: plan.viewport,
    settle: plan.settle,
    frozenTime: plan.frozenTime,
  });
  try {
    await signInSide({ plan, side });
  } catch (thrown) {
    await side.browser.close().catch(() => undefined);
    throw thrown;
  }
  return side;
};

const captureSide = async ({
  plan,
  side,
  collect,
}: {
  plan: Plan;
  side: Side;
  collect: Collect;
}): Promise<void> => {
  try {
    await captureRoutes({ plan, side, collect });
    for (const flow of plan.flows) {
      await captureFlow({ plan, flow, side, collect });
    }
  } finally {
    await side.browser.close().catch(() => undefined);
  }
};

/** Replayed sides go first (they are free), then the candidate, so it signs in first. */
const captureOrder = (side: PlanSide): number => {
  if (side.replay !== undefined) return 0;
  return side.name === "candidate" ? 1 : 2;
};

const main = async (): Promise<void> => {
  const plan = readPlan(process.argv.slice(2));
  emit({ message: { type: "ready" }, out });
  const pairing = new Pairing(plan, diffScreenshots);
  const collect: Collect = (message) => {
    emit({ message, out });
    const diff = pairing.add(message);
    if (diff !== null) emit({ message: diff, out });
  };
  const ordered = plan.sides.toSorted((a, b) => captureOrder(a) - captureOrder(b));
  for (const definition of ordered) {
    if (definition.replay === undefined) continue;
    for (const message of readReplay({ file: definition.replay, plan, side: definition.name })) {
      collect(message);
    }
  }
  const live: Side[] = [];
  try {
    for (const definition of ordered) {
      if (definition.replay === undefined) live.push(await openSignedIn({ plan, definition }));
    }
  } catch (thrown) {
    await Promise.all(live.map((side) => side.browser.close().catch(() => undefined)));
    throw thrown;
  }
  // Both sides are signed in by now, so they capture at once; one failing stops the other.
  await Promise.all(live.map((side) => captureSide({ plan, side, collect }))).catch(
    async (thrown: unknown) => {
      await Promise.all(live.map((side) => side.browser.close().catch(() => undefined)));
      throw thrown;
    },
  );
  emit({ message: { type: "done" }, out });
};

main().catch((thrown: unknown) => {
  emit({
    message: { type: "error", message: String(thrown instanceof Error ? thrown.message : thrown) },
    out,
  });
  process.exitCode = 1;
});
