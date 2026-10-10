/**
 * The serving half of the upgrade gate (migrations blitz plan, D5): after boot opened the stores
 * and before the application runs, an api or worker asks its gate and refuses to start by name.
 * `@langwatch/upgrade/gate` answers it. Spec: specs/upgrade/serving-gate.feature.
 */
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { setLedgerCurrent } from "@langwatch/api";

import type { ServerRole } from "../feature-installer.ts";
import { UPGRADE_CONSOLE_TOKEN_TTL_MS, type UpgradeConsole } from "../lifecycle/liveness-thread.ts";
import type { ServerComponent, ServerLogger } from "../server.ts";

/** Tasks runs `upgrade` itself and is never gated. */
export type UpgradeGatedRole = Exclude<ServerRole, "tasks">;

/** What the api's upgrade console shows of a run that failed (UPGRADE-CONSOLE, 2026-10-09). */
export type UpgradeGateFailedRun = Pick<UpgradeConsole, "failedSteps" | "logTail">;

/** The api serves while the worker upgrades, and asks again (UIW-1, NO-HOLDS). */
export type UpgradeGateWaiting = Readonly<{
  admitted: false;
  outcome: "upgrading";
  outstanding: readonly string[];
  /** UIW-7: read from the ledger; only a failed first install carries one. */
  failedRun?: UpgradeGateFailedRun;
}>;

export type UpgradeGateVerdict =
  | Readonly<{ admitted: true } | { admitted: false; refusal: string }>
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
  /** The console's Retry: the ledger's failed steps back to `pending` for the worker's run. */
  retryFailedSteps?: () => Promise<void>;
}>;

/** Shows a failure's console (true on Retry, never settling after), writes its Retry, lifts it. */
type OperatorConsole = Readonly<{
  show: (failedRun: UpgradeGateFailedRun) => Promise<boolean>;
  retry: () => Promise<void>;
  lift: () => Promise<void>;
}>;

const NEVER = new Promise<boolean>(() => undefined);

/** What an operator reads on the gate's lines: the phase, what it waits on, what to do next. */
const GATE_PHASE = "upgrade-gate";
const UPGRADING_PHASE = "upgrading";
const CONSOLE_PHASE = "upgrade-console";
const LEDGER = "the upgrade ledger (DATABASE_URL)";
const LEDGER_UNREADABLE_NEXT =
  "check DATABASE_URL reaches Postgres and `pnpm task upgrade status` answers, then start this process again";
const REFUSED_NEXT = "do what the refusal names, then start this process again";
/** How often an upgrading api asks the ledger again (UPGRADE-IN-WORKER). */
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
 * A refusal, or an unanswering gate, throws; an upgrading api serves at once (NO-HOLDS) and asks
 * on until current. `onFailed` shows a failed first install's console (UIW-7).
 */
export function upgradeGateComponent({
  server,
  role,
  gate,
  logger,
  onFailed,
  onConsoleLifted,
  reAskMs = RE_ASK_MS,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
  onFailed?: (upgradeConsole: UpgradeConsole) => Promise<boolean>;
  onConsoleLifted?: () => Promise<void>;
  reAskMs?: number;
}): ServerComponent {
  let admitted = false;
  /** Set while an upgrading api serves and asks on until current. */
  let upgrading: Readonly<{ stop: AbortController; asking: Promise<void> }> | undefined;
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
  const retryFailedSteps = gate.retryFailedSteps;
  const operatorConsole: OperatorConsole | undefined =
    onFailed && retryFailedSteps
      ? {
          show: (failedRun) =>
            onFailed({ ...redactFailedRun(failedRun), ...issueConsoleToken() }).then(
              (retried) => retried || NEVER,
            ),
          retry: retryFailedSteps,
          lift: onConsoleLifted ?? (async () => undefined),
        }
      : undefined;
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
      const say = (fields: object, line: string) =>
        logger.info(fields, `${server} (${role}): ${line}`);
      let verdict: UpgradeGateVerdict;
      try {
        verdict = await gate.admit();
      } catch (error) {
        const cause = `the upgrade ledger could not be read (DATABASE_URL): ${messageOf(error)}`;
        return refuse(cause, LEDGER_UNREADABLE_NEXT);
      }
      const serving = () => {
        admitted = true;
        setLedgerCurrent({ current: true });
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
      };
      if (isWaiting(verdict)) {
        say(
          {
            phase: UPGRADING_PHASE,
            waitingOn: "the worker's upgrade run",
            next: "nothing to do: this api serves meanwhile",
          },
          `the installation is upgrading (${verdict.outstanding.join(", ")}); serving and asking again every ${reAskMs / 1000} s`,
        );
        upgrading = askInBackground({
          first: verdict,
          admit: gate.admit,
          operatorConsole,
          reAskMs,
          say,
          onCurrent: serving,
        });
        return;
      }
      if (!verdict.admitted) {
        return refuse(verdict.refusal, REFUSED_NEXT);
      }
      serving();
    },
    ready: async () => {
      if (!admitted)
        throw new Error(`${server} (${role}) is upgrading; ready once the ledger is current`);
    },
    stop: async () => {
      upgrading?.stop.abort();
      await upgrading?.asking;
      setLedgerCurrent({ current: false });
      if (admitted) await gate.release();
    },
  };
}

/** Asks on after start returned; `onCurrent` runs once with the console lifted. */
function askInBackground({
  onCurrent,
  ...asking
}: Omit<Parameters<typeof askUntilCurrent>[0], "signal"> & { onCurrent: () => void }) {
  const stop = new AbortController();
  const current = askUntilCurrent({ ...asking, signal: stop.signal });
  return {
    stop,
    asking: current.then(async (admitted) => {
      if (!admitted) return;
      await asking.operatorConsole?.lift();
      onCurrent();
    }),
  };
}

type ConsoleState = { shown: string; retried: Promise<boolean> };

/**
 * An upgrading api asks until the ledger is current; true once admitted, false when stopped. An
 * unreadable ledger or a refusal mid-upgrade is said and asked again: the process serves already.
 * A console Retry returns the failed steps to `pending` (UIW-7, UIW-LOSER-WAITS).
 */
async function askUntilCurrent({
  first,
  admit,
  operatorConsole,
  reAskMs,
  say,
  signal,
}: {
  first: UpgradeGateWaiting;
  admit: () => Promise<UpgradeGateVerdict>;
  operatorConsole: OperatorConsole | undefined;
  reAskMs: number;
  say: (fields: object, line: string) => void;
  signal: AbortSignal;
}): Promise<boolean> {
  const state: ConsoleState = { shown: "", retried: NEVER };
  let verdict: UpgradeGateVerdict = first;
  while (!signal.aborted) {
    if (verdict.admitted) return true;
    if (isWaiting(verdict)) {
      await showConsoleOnce({ verdict, state, operatorConsole });
    } else {
      say(
        {
          phase: UPGRADING_PHASE,
          waitingOn: "the upgrade ledger",
          next: "nothing to do: it asks again",
        },
        redactUrls(verdict.refusal),
      );
    }
    const asleep = sleep(reAskMs, undefined, { signal }).then(
      () => false,
      () => false,
    );
    if (await Promise.race([state.retried, asleep])) {
      await operatorConsole?.retry();
      Object.assign(state, { shown: "", retried: NEVER });
    }
    if (signal.aborted) break;
    verdict = await admit().catch((error: unknown): UpgradeGateVerdict => ({
      admitted: false,
      refusal: `the upgrade ledger could not be read: ${messageOf(error)}`,
    }));
  }
  return false;
}

/** Opens a failed first install's console once per failure, a new token each; lifts it after. */
async function showConsoleOnce({
  verdict,
  state,
  operatorConsole,
}: {
  verdict: UpgradeGateWaiting;
  state: ConsoleState;
  operatorConsole: OperatorConsole | undefined;
}): Promise<void> {
  if (!operatorConsole) return;
  const failedRun = verdict.failedRun;
  if (!failedRun) {
    if (state.shown !== "") await operatorConsole.lift();
    Object.assign(state, { shown: "", retried: NEVER });
    return;
  }
  const failure = JSON.stringify(failedRun.failedSteps);
  if (failure === state.shown) return;
  state.shown = failure;
  state.retried = operatorConsole.show(failedRun);
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
