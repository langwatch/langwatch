/**
 * @vitest-environment node
 * Finishing a cutover: the durable gate lands before anything is removed,
 * every step re-reads its evidence, and an interrupted attempt resumes.
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  SsoConnectionInvalidTransitionError,
  type SsoConnectionLifecycleState,
  type SsoMigrationBlockerView,
  type SsoMigrationPhase,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoConnectionService } from "../sso-connection.service.ts";
import type { SsoLegacyIdentityRetirementService } from "../sso-legacy-identity-retirement.service.ts";
import { SsoMigrationFinalizationService } from "../sso-migration-finalization.service.ts";
import type { SsoMigrationProgressService } from "../sso-migration-progress.service.ts";

const ORG = "org_acme";
const LEGACY = "ssoc_legacy";
const REPLACEMENT = "ssoc_replacement";

const request = {
  organizationId: ORG,
  replacementConnectionId: REPLACEMENT,
  actorUserId: "user_admin",
};

function ceremony({
  phase = "GRACE_DIRECT",
  legacyState = "ACTIVE",
  blockers = [],
  retirementFrees = true,
  paired = true,
}: {
  phase?: SsoMigrationPhase;
  legacyState?: SsoConnectionLifecycleState;
  blockers?: SsoMigrationBlockerView[];
  /** Whether the retirement pass actually frees the legacy access. */
  retirementFrees?: boolean;
  /** Whether the organization is running a cutover at all. */
  paired?: boolean;
} = {}) {
  const state = { phase, legacyState, legacyAccessRetired: false };
  const calls: string[] = [];
  const record = (name: string, effect: () => void) => {
    calls.push(name);
    effect();
  };
  const step = (name: string, effect: () => void) => async () => {
    record(name, effect);

    return [];
  };

  const service = SsoMigrationFinalizationService.create({
    connections: () =>
      createApiFixture<SsoConnectionService>({
        beginMigrationFinalization: step("beginMigrationFinalization", () => {
          state.phase = "FINALIZING";
        }),
        finalizeMigration: step("finalizeMigration", () => {
          state.phase = "FINALIZED";
        }),
        requestTeardown: step("requestTeardown", () => {
          state.legacyState = "TEARDOWN_PENDING";
        }),
        completeTeardown: step("completeTeardown", () => {
          state.legacyState = "TORN_DOWN";
        }),
      }),
    evidence: createApiFixture<SsoMigrationProgressService>({
      getFinalizationEvidence: async () => {
        if (!paired) throw new SsoConnectionInvalidTransitionError("no pair");

        return {
          legacyConnectionId: LEGACY,
          legacyState: state.legacyState,
          phase: state.phase,
          blockers,
          legacyAccessRetired: state.legacyAccessRetired,
        };
      },
    }),
    retirement: createApiFixture<SsoLegacyIdentityRetirementService>({
      retire: async () => {
        record("retire", () => {
          state.legacyAccessRetired = retirementFrees;
        });
      },
    }),
  });

  return { service, state, calls };
}

describe("finishing a direct cutover", () => {
  it("gates the callbacks, retires, tears the legacy half down, then finalizes", async () => {
    const { service, state, calls } = ceremony();

    await service.finalize(request);

    expect(calls).toEqual([
      "beginMigrationFinalization",
      "retire",
      "requestTeardown",
      "completeTeardown",
      "finalizeMigration",
    ]);
    expect(state).toEqual({
      phase: "FINALIZED",
      legacyState: "TORN_DOWN",
      legacyAccessRetired: true,
    });
  });

  it("resumes an interrupted attempt without gating twice", async () => {
    const { service, calls } = ceremony({ phase: "FINALIZING" });

    await service.finalize(request);

    expect(calls).not.toContain("beginMigrationFinalization");
    expect(calls).toContain("finalizeMigration");
  });

  it("completes a teardown already requested rather than requesting another", async () => {
    const { service, calls } = ceremony({ phase: "FINALIZING", legacyState: "TEARDOWN_PENDING" });

    await service.finalize(request);

    expect(calls).not.toContain("requestTeardown");
    expect(calls).toContain("completeTeardown");
  });

  it("does nothing at all once the cutover is finalized", async () => {
    const { service, calls } = ceremony({ phase: "FINALIZED" });

    await service.finalize(request);

    expect(calls).toEqual([]);
  });

  it("refuses while any blocker stands, before the gate lands", async () => {
    const { service, calls } = ceremony({
      blockers: [{ code: "members-not-linked", message: "Two members have not signed in." }],
    });

    await expect(service.finalize(request)).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
      meta: { blockerCodes: ["members-not-linked"] },
    });
    expect(calls).toEqual([]);
  });

  it("refuses to finalize when legacy access survives the retirement pass", async () => {
    const { service, calls } = ceremony({ retirementFrees: false });

    await expect(service.finalize(request)).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
      meta: { blockerCodes: ["legacy-access-remains"] },
    });
    expect(calls).not.toContain("finalizeMigration");
  });

  it("refuses a connection running no cutover", async () => {
    const { service } = ceremony({ paired: false });

    await expect(service.finalize(request)).rejects.toMatchObject({
      code: "sso_connection_invalid_transition",
    });
  });

  it("refuses a pair that never chose the direct route", async () => {
    const { service } = ceremony({ phase: "GRACE_LEGACY" });

    await expect(service.finalize(request)).rejects.toMatchObject({
      code: "sso_connection_invalid_transition",
    });
  });
});
