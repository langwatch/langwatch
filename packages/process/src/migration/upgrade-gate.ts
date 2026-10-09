/**
 * The serving half of the upgrade gate (migrations blitz plan, D5): after boot opened the stores
 * and before the application runs, an api or worker asks its gate and refuses to start by name.
 * `@langwatch/upgrade/gate` answers it. Spec: specs/upgrade/serving-gate.feature.
 */
import type { ServerRole } from "../feature-installer.ts";
import type { UpgradeHolding } from "../lifecycle/liveness-thread.ts";
import type { ServerComponent, ServerLogger } from "../server.ts";

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
  backgroundSteps?: UpgradeGateBackgroundSteps;
}>;

/** What an operator reads on the gate's lines: the phase, what it waits on, what to do next. */
const GATE_PHASE = "upgrade-gate";
const LEDGER = "the upgrade ledger (DATABASE_URL)";
const LEDGER_UNREADABLE_NEXT =
  "check DATABASE_URL reaches Postgres and `pnpm task upgrade status` answers, then start this process again";
const REFUSED_NEXT = "do what the refusal names, then start this process again";

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
 * A refusal, or an unanswering gate, throws; once admitted it serves until stopped: a roster
 * blip never takes it out of service (2026-10-09). `onHolding` holds the upgrading page (Q-U4).
 */
export function upgradeGateComponent({
  server,
  role,
  gate,
  logger,
  onHolding,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
  onHolding?: (holding: UpgradeHolding | undefined) => Promise<void>;
}): ServerComponent {
  let admitted = false;
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
      // Only the gate's phase: its steps are behind `admit`, and a refusal's text is never shown.
      await onHolding?.({ phase: GATE_PHASE, outstandingStepIds: [] });
      try {
        verdict = await gate.admit();
      } catch (error) {
        const cause = `the upgrade ledger could not be read (DATABASE_URL): ${messageOf(error)}`;
        return refuse(cause, LEDGER_UNREADABLE_NEXT);
      } finally {
        await onHolding?.(undefined);
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
    },
    stop: async () => {
      if (admitted) await gate.release();
    },
  };
}

function messageOf(error: unknown): string {
  return redactUrls(error instanceof Error ? error.message : String(error));
}

/** A connection URL's password never reaches a log line. */
function redactUrls(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/gi, "$1:***@");
}
