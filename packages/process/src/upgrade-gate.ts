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

/** What a gate answers: `admit` before the application starts, `release` at a graceful stop. */
export type UpgradeGate = Readonly<{
  admit: () => Promise<UpgradeGateVerdict>;
  release: () => Promise<void>;
}>;

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
 */
export function upgradeGateComponent({
  server,
  role,
  gate,
  logger,
}: {
  server: string;
  role: UpgradeGatedRole;
  gate: UpgradeGate;
  logger: ServerLogger;
}): ServerComponent {
  let admitted = false;
  const refuse = (refusal: string): never => {
    const error = new UpgradeGateRefusedError({ server, role, refusal });
    logger.error({ role, code: error.code }, error.message);
    throw error;
  };
  return {
    name: `${server} upgrade gate`,
    start: async () => {
      let verdict: UpgradeGateVerdict;
      try {
        verdict = await gate.admit();
      } catch (error) {
        return refuse(`the upgrade ledger could not be read: ${messageOf(error)}`);
      }
      if (!verdict.admitted) return refuse(verdict.refusal);
      admitted = true;
      logger.info({ role }, `${server}: the installation is current for this image`);
    },
    stop: async () => {
      if (admitted) await gate.release();
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
