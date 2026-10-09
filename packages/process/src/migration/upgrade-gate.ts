/**
 * The serving half of the upgrade gate (migrations blitz plan, D5): after boot opened the stores
 * and before the application runs, an api or worker asks its gate and refuses to start by name.
 * `@langwatch/upgrade/gate` answers it. Spec: specs/upgrade/serving-gate.feature.
 */
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import type { ServerRole } from "../feature-installer.ts";
import {
  UPGRADE_CONSOLE_TOKEN_TTL_MS,
  type UpgradeConsole,
  type UpgradeHolding,
} from "../lifecycle/liveness-thread.ts";
import type { ServerComponent, ServerLogger } from "../server.ts";

/** Tasks runs `upgrade` itself and is never gated. */
export type UpgradeGatedRole = Exclude<ServerRole, "tasks">;

/** What the api's upgrade console shows of a run that failed (UPGRADE-CONSOLE, 2026-10-09). */
export type UpgradeGateFailedRun = Pick<UpgradeConsole, "failedSteps" | "logTail">;

/** The api holds (a Postgres schema step outstanding) or upgrades, and asks again (UIW-1). */
export type UpgradeGateWaiting = Readonly<{
  admitted: false;
  outcome: "holding" | "upgrading";
  outstanding: readonly string[];
}>;

export type UpgradeGateVerdict =
  | Readonly<
      { admitted: true } | { admitted: false; refusal: string; failedRun?: UpgradeGateFailedRun }
    >
  | UpgradeGateWaiting;

/** A worker's declared background steps, run by the gate's package (round 14: framework runs). */
export type UpgradeGateBackgroundSteps = Readonly<{
  isStep: (contribution: unknown) => contribution is { readonly id: string };
  start: (steps: readonly { readonly id: string }[]) => Readonly<{ stop: () => Promise<void> }>;
}>;

/** What a gate answers: `admit` before the application starts, `release` at a graceful stop. */
export type UpgradeGate = Readonly<{
  admit: () => Promise<UpgradeGateVerdict>;
  release: () => Promise<void>;
  backgroundSteps?: UpgradeGateBackgroundSteps;
}>;

/** What an operator reads on the gate's lines: the phase, what it waits on, what to do next. */
const GATE_PHASE = "upgrade-gate";
const CONSOLE_PHASE = "upgrade-console";
const LEDGER = "the upgrade ledger (DATABASE_URL)";
const LEDGER_UNREADABLE_NEXT =
  "check DATABASE_URL reaches Postgres and `pnpm task upgrade status` answers, then start this process again";
const REFUSED_NEXT = "do what the refusal names, then start this process again";
/** How often a holding or upgrading api asks the ledger again (UPGRADE-IN-WORKER). */
const RE_ASK_MS = 10_000;

const isWaiting = (verdict: UpgradeGateVerdict): verdict is UpgradeGateWaiting =>
  !verdict.admitted && "outcome" in verdict;

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
 * Hosted by the preamble: starts after boot and before the application runtime, stops after it.
 * A refusal, or an unanswering gate, throws; once admitted it serves until stopped (2026-10-09).
 * `onHolding` holds the upgrading page (Q-U4); `onFailed` shows a failed run's console (D5).
 */
export function upgradeGateComponent({
  server,
  role,
  gate,
  logger,
  onHolding,
  onFailed,
  reAskMs = RE_ASK_MS,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
  onHolding?: (holding: UpgradeHolding | undefined) => Promise<void>;
  onFailed?: (upgradeConsole: UpgradeConsole) => Promise<boolean>;
  reAskMs?: number;
}): ServerComponent {
  let admitted = false;
  /** D1, D2: a fresh token per failed run, printed on one log line; only its hash is kept. */
  const issueConsoleToken = (): Pick<UpgradeConsole, "tokenSha256" | "tokenTtlMs"> => {
    const token = randomBytes(32).toString("base64url");
    const minutes = UPGRADE_CONSOLE_TOKEN_TTL_MS / 60_000;
    logger.error(
      { role, phase: CONSOLE_PHASE, waitingOn: "an operator", next: "open the console" },
      `${server} (${role}): the upgrade failed; this api holds the door with the upgrade console`,
    );
    const fields = {
      role,
      phase: CONSOLE_PHASE,
      waitingOn: "an operator",
      next: "open the console",
    };
    const line = `${server} (${role}): open any page of this api in a browser and enter this console token. Only this pod shows the console and it reports not ready meanwhile, so on Kubernetes reach it with \`kubectl port-forward pod/${hostname()} 8080:<api port>\` and open http://localhost:8080. The token is valid once for ${minutes} minutes: ${token}`;
    warnOrInfo({ logger, fields, line });
    return {
      tokenSha256: createHash("sha256").update(token).digest("hex"),
      tokenTtlMs: UPGRADE_CONSOLE_TOKEN_TTL_MS,
    };
  };
  /** D5: only the console's Retry runs the upgrade again; with no console to show, it refuses. */
  const admitThroughConsole = async (): Promise<UpgradeGateVerdict> => {
    for (;;) {
      const verdict = await gate.admit();
      if (verdict.admitted || !("failedRun" in verdict) || !verdict.failedRun || !onFailed) {
        return verdict;
      }
      const retried = await onFailed({
        ...redactFailedRun(verdict.failedRun),
        ...issueConsoleToken(),
      });
      if (!retried) return verdict;
      await onHolding?.({ phase: GATE_PHASE, outstandingStepIds: [] });
    }
  };
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
      let verdict: Exclude<UpgradeGateVerdict, UpgradeGateWaiting>;
      // Only the gate's phase: its steps are behind `admit`, and a refusal's text is never shown.
      await onHolding?.({ phase: GATE_PHASE, outstandingStepIds: [] });
      try {
        verdict = await admitWhenCurrent({
          admit: admitThroughConsole,
          onHolding,
          reAskMs,
          say: (fields, line) => logger.info(fields, `${server} (${role}): ${line}`),
        });
      } catch (error) {
        const cause = `the upgrade ledger could not be read (DATABASE_URL): ${messageOf(error)}`;
        return refuse(cause, LEDGER_UNREADABLE_NEXT);
      } finally {
        await onHolding?.(undefined);
      }
      if (!verdict.admitted) {
        return refuse(verdict.refusal, REFUSED_NEXT);
      }
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
    },
    stop: async () => {
      if (admitted) await gate.release();
    },
  };
}

/** The worker runs the upgrade; the api re-asks every 10 s, holding the door meanwhile. */
async function admitWhenCurrent({
  admit,
  onHolding,
  reAskMs,
  say,
}: {
  admit: () => Promise<UpgradeGateVerdict>;
  onHolding: ((holding: UpgradeHolding | undefined) => Promise<void>) | undefined;
  reAskMs: number;
  say: (fields: object, line: string) => void;
}): Promise<Exclude<UpgradeGateVerdict, UpgradeGateWaiting>> {
  let phase = "";
  for (;;) {
    const verdict = await admit();
    if (!isWaiting(verdict)) return verdict;
    if (verdict.outcome !== phase) {
      const next = "nothing to do: this api serves once the ledger is current";
      say(
        { phase: verdict.outcome, waitingOn: "the worker's upgrade run", next },
        `the installation is ${verdict.outcome} (${verdict.outstanding.join(", ")}); asking again every ${reAskMs / 1000} s`,
      );
      phase = verdict.outcome;
    }
    await onHolding?.({ phase: verdict.outcome, outstandingStepIds: verdict.outstanding });
    await sleep(reAskMs);
  }
}

function messageOf(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error));
}

/** A connection URL's password never reaches a log line. */
function redactUrls(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/gi, "$1:***@");
}

/** CONSOLE-FOLLOWUPS: the token line prints at warn, so a warn-level install still shows it. */
function warnOrInfo({
  logger,
  fields,
  line,
}: {
  logger: ServerLogger;
  fields: object;
  line: string;
}): void {
  if (logger.warn) logger.warn(fields, line);
  else logger.info(fields, line);
}

/** CONSOLE-FOLLOWUPS: a connection URL's password never reaches the console page either. */
function redactFailedRun({ failedSteps, logTail }: UpgradeGateFailedRun): UpgradeGateFailedRun {
  return {
    failedSteps: failedSteps.map(({ id, error }) => ({
      id,
      error: error === null ? null : redactUrls(error),
    })),
    logTail: logTail.map((logLine) => redactUrls(logLine)),
  };
}
