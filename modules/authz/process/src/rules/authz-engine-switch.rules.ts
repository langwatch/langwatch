import { AUTHZ_ENGINE_MIGRATION_NAME } from "@langwatch/authz-contract";
import { type Instant, Temporal } from "@langwatch/time";

/** Whether the engine answers an organization's permission checks, and since when. */
export type AuthzEngineSwitch = Readonly<{ onEngine: boolean; switchedAt: Instant | null }>;

/** Authz's own row for the organization. */
export type OwnEngineSwitchRow = Readonly<{ onEngine: boolean; switchedAt: Instant }>;

/** The row an older image, or the legacy runner and rollback, still write in ops' state table. */
export type LegacyEngineStateRow = Readonly<{ status: string; occurredAt: Instant }>;

/** The engine migration's declared step id; its state was copied from the legacy name. */
export const AUTHZ_ENGINE_STEP_ID = "authz:engine" as const;

/** Whether a rolled-back step is the engine migration, under its legacy name or its step id. */
export function isEngineMigrationStep(stepId: string): boolean {
  return stepId === AUTHZ_ENGINE_STEP_ID || stepId === AUTHZ_ENGINE_MIGRATION_NAME;
}

export const LEGACY_ENGINE: AuthzEngineSwitch = { onEngine: false, switchedAt: null };

/**
 * The newer of the two rows answers, authz's own on a tie, as licensing's licence rows and
 * organization's columns do while both are written (ARCHITECTURE.md §7). No row is legacy.
 */
export function decideEngineSwitch({
  own,
  legacy,
}: {
  own: OwnEngineSwitchRow | null;
  legacy: LegacyEngineStateRow | null;
}): AuthzEngineSwitch {
  if (own && (!legacy || Temporal.Instant.compare(own.switchedAt, legacy.occurredAt) >= 0)) {
    return { onEngine: own.onEngine, switchedAt: own.switchedAt };
  }
  if (legacy?.status === "finalized") return { onEngine: true, switchedAt: legacy.occurredAt };
  return legacy ? { onEngine: false, switchedAt: legacy.occurredAt } : LEGACY_ENGINE;
}
