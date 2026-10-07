/**
 * The serving half of the upgrade gate (migrations blitz plan, D5): after boot opened the stores
 * and before the application runs, an api or worker asks its gate and refuses to start by name.
 * `@langwatch/upgrade/gate` answers it. Spec: specs/upgrade/serving-gate.feature.
 */
import type { ServerRole } from "./feature-installer.ts";
import type { ServerComponent, ServerLogger } from "./server.ts";

/** Tasks runs `upgrade` itself and is never gated. */
export type UpgradeGatedRole = Exclude<ServerRole, "tasks">;

export type UpgradeGateVerdict = Readonly<
  { admitted: true } | { admitted: false; refusal: string }
>;

/** A worker's declared background steps, run by the gate's package (round 14: framework runs). */
export type UpgradeGateBackgroundSteps = Readonly<{
  isStep: (contribution: unknown) => contribution is { readonly id: string };
  start: (steps: readonly { readonly id: string }[]) => Readonly<{ stop: () => Promise<void> }>;
}>;

/** What a gate answers: `admit` before the application starts, `release` at a graceful stop. */
export type UpgradeGate = Readonly<{
  admit: () => Promise<UpgradeGateVerdict>;
  release: () => Promise<void>;
  /** False once its presence lapsed, true after a good write (round 22); absent: always true. */
  serving?: () => boolean;
  backgroundSteps?: UpgradeGateBackgroundSteps;
}>;

/** What an operator reads on the gate's lines: the phase, what it waits on, what to do next. */
const GATE_PHASE = "upgrade-gate";
const LEDGER = "the upgrade ledger (DATABASE_URL)";
const PRESENCE_WAIT = "a presence write to the upgrade ledger (DATABASE_URL)";
const LEDGER_UNREADABLE_NEXT =
  "check DATABASE_URL reaches Postgres and `pnpm task upgrade status` answers, then start this process again";
const REFUSED_NEXT = "do what the refusal names, then start this process again";

/** How often an admitted gate is asked whether it still serves. */
export const UPGRADE_GATE_SERVING_POLL_MS = 1_000;

export class UpgradeGateRefusedError extends Error {
  readonly code = "upgrade_gate_refused";
  readonly role: UpgradeGatedRole;
  readonly refusal: string;
  constructor({
    server,
    role,
    refusal,
  }: {
    server: string;
    role: UpgradeGatedRole;
    refusal: string;
  }) {
    super(`${server} (${role}) refuses to serve: ${refusal}`);
    this.name = "UpgradeGateRefusedError";
    this.role = role;
    this.refusal = refusal;
  }
}

export function assertGatedRole(role: string): asserts role is UpgradeGatedRole {
  if (role !== "api" && role !== "worker") {
    throw new Error(
      `The upgrade gate guards the api and worker roles only; "${role}" runs the upgrade and is never gated.`,
    );
  }
}

/**
 * Hosted by the preamble, so it starts after boot and before the application runtime, and stops
 * after it: presence outlives the last write. A refusal, or a gate that cannot answer, throws.
 * Once admitted, a lapse fails readiness and `onServingChange` hears each turn (round 22).
 */
export function upgradeGateComponent({
  server,
  role,
  gate,
  logger,
  onServingChange,
  pollEveryMs = UPGRADE_GATE_SERVING_POLL_MS,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
  onServingChange?: (serving: boolean) => void | Promise<void>;
  pollEveryMs?: number;
}): ServerComponent {
  let admitted = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  const watch = servingWatcher({ server, role, gate, logger, onServingChange });
  const refuse = (refusal: string, next: string): never => {
    const error = new UpgradeGateRefusedError({ server, role, refusal: redactUrls(refusal) });
    logger.error(
      { role, code: error.code, phase: GATE_PHASE, waitingOn: "nothing", next },
      error.message,
    );
    throw error;
  };
  return {
    name: `${server} upgrade gate`,
    start: async () => {
      const startedAt = performance.now();
      logger.info(
        {
          role,
          phase: GATE_PHASE,
          waitingOn: LEDGER,
          next: "nothing to do: the check takes a moment",
        },
        `${server} (${role}): checking the upgrade ledger before serving`,
      );
      let verdict: UpgradeGateVerdict;
      try {
        verdict = await gate.admit();
      } catch (error) {
        const cause = `the upgrade ledger could not be read (DATABASE_URL): ${messageOf(error)}`;
        return refuse(cause, LEDGER_UNREADABLE_NEXT);
      }
      if (!verdict.admitted) return refuse(verdict.refusal, REFUSED_NEXT);
      admitted = true;
      const elapsedMs = Math.round(performance.now() - startedAt);
      logger.info(
        {
          role,
          phase: GATE_PHASE,
          waitingOn: "nothing",
          elapsedMs,
          next: "nothing to do: it serves",
        },
        `${server} (${role}): the installation is current for this image; serving (checked in ${elapsedMs} ms)`,
      );
      if (gate.serving) {
        poll = setInterval(watch, pollEveryMs);
        poll.unref?.();
      }
    },
    ready: async () => {
      if (admitted && gate.serving?.() === false) {
        throw new Error(`${server} (${role}) stopped serving: its upgrade presence lapsed`);
      }
    },
    stop: async () => {
      clearInterval(poll);
      if (admitted) await gate.release();
    },
  };
}

/** Asked on every poll: reports and hands on each turn of `serving`, never the same twice. */
function servingWatcher({
  server,
  role,
  gate,
  logger,
  onServingChange,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
  onServingChange?: (serving: boolean) => void | Promise<void>;
}): () => void {
  let serving = true;
  let stoppedAt = 0;
  const pauses = role === "worker" ? "; the worker takes no new jobs (in-flight ones finish)" : "";
  const resumes = role === "worker" ? "; the worker takes new jobs again" : "";
  return () => {
    const now = gate.serving?.() ?? true;
    if (now === serving) return;
    serving = now;
    const phase = "presence";
    if (now) {
      const stoppedForMs = Math.round(performance.now() - stoppedAt);
      logger.info(
        { role, phase, waitingOn: "nothing", stoppedForMs, next: "nothing to do: it serves" },
        `${server} (${role}) serves again: its presence was written after ${stoppedForMs} ms${resumes}`,
      );
    } else {
      stoppedAt = performance.now();
      logger.error(
        { role, phase, waitingOn: PRESENCE_WAIT, next: LEDGER_UNREADABLE_NEXT },
        `${server} (${role}) stopped serving: its upgrade presence lapsed; readiness answers 503 ` +
          `until a presence write succeeds${pauses}`,
      );
    }
    void Promise.resolve(onServingChange?.(now)).catch((error: unknown) =>
      logger.error({ role, error }, `${server}: a serving change was not applied`),
    );
  };
}

function messageOf(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error));
}

/** A connection URL's password never reaches a log line. */
function redactUrls(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/gi, "$1:***@");
}
