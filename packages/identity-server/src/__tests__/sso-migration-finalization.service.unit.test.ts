import {
  emptySsoConnection,
  type SsoConnectionCommand,
  type SsoConnectionState,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  SsoMigrationFinalizationService,
  type SsoLegacyIdentityRetirementPort,
  type SsoMigrationFinalizationEvidence,
  type SsoMigrationFinalizationReadPort,
} from "../sso-migration-finalization.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

const ORG = "org_acme";
const LEGACY = "ssoc_legacy";
const DIRECT = "ssoc_direct";
const ACTOR = "user_admin";
const T0 = 1_756_000_000_000;

let heads: InMemoryConnections;
let commands: SsoConnectionCommand[];
let connectionService: SsoConnectionService;
let retired: boolean;
let blockers: SsoMigrationFinalizationEvidence["blockers"];
let retirement: SsoLegacyIdentityRetirementPort;
let evidence: SsoMigrationFinalizationReadPort;
let finalizer: SsoMigrationFinalizationService;

beforeEach(() => {
  heads = new InMemoryConnections();
  commands = [];
  retired = false;
  blockers = [];
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      commands.push(command);
      heads.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({ ...fact, occurredAt: command.data.occurredAtMs }));
    },
  };
  connectionService = new SsoConnectionService(
    new SsoConnectionGuards({
      connections: heads,
      registrationSlots: heads,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([]),
      licenseAuthority: new StubLicenseAuthority(),
    }),
    ledger,
  );
  seedPair();
  evidence = {
    inspect: vi.fn(async () => {
      const replacement = await heads.findConnection({ connectionId: DIRECT });
      const legacy = await heads.findConnection({ connectionId: LEGACY });
      if (!replacement?.migrationPhase || !legacy) return null;
      return {
        legacyConnectionId: LEGACY,
        legacyState: legacy.state,
        phase: replacement.migrationPhase,
        blockers,
        legacyAccessRetired: retired,
      };
    }),
  };
  retirement = {
    retire: vi.fn(async () => {
      retired = true;
    }),
  };
  let sequence = 0;
  finalizer = new SsoMigrationFinalizationService({
    connections: () => connectionService,
    evidence,
    retirement,
    now: () => T0 + 100,
    newCommandId: () => `command_finalize_${sequence++}`,
  });
});

describe("legacy SSO migration finalization", () => {
  it("refuses operational blockers before persisting the callback gate", async () => {
    blockers = [
      {
        code: "members-not-linked",
        message: "One current member is not linked to direct SSO.",
      },
    ];

    await expect(run()).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
      meta: { blockerCodes: ["members-not-linked"] },
    });
    expect(commands).toHaveLength(0);
    expect(retirement.retire).not.toHaveBeenCalled();
  });

  it("leaves FINALIZING as the durable callback gate when retirement is interrupted", async () => {
    vi.mocked(retirement.retire).mockRejectedValueOnce(
      new Error("identity ledger temporarily unavailable"),
    );

    await expect(run()).rejects.toThrow("identity ledger temporarily unavailable");

    expect(await state(DIRECT)).toMatchObject({ migrationPhase: "FINALIZING" });
    expect(await state(LEGACY)).toMatchObject({ state: "ACTIVE" });
    expect(commands.map(({ type }) => type)).toEqual([
      "lw.identity.begin_migration_finalization",
    ]);
  });

  it("rechecks a legacy callback that raced the gate before retiring anything", async () => {
    const original = vi.mocked(evidence.inspect).getMockImplementation();
    if (!original) throw new Error("evidence double has no implementation");
    let reads = 0;
    vi.mocked(evidence.inspect).mockImplementation(async (args) => {
      const result = await original(args);
      reads += 1;
      if (!result || reads === 1) return result;
      return {
        ...result,
        blockers: [
          {
            code: "legacy-activity-not-quiet",
            message: "A successful legacy callback raced finalization.",
          },
        ],
      };
    });

    await expect(run()).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
      meta: { blockerCodes: ["legacy-activity-not-quiet"] },
    });

    expect(await state(DIRECT)).toMatchObject({ migrationPhase: "FINALIZING" });
    expect(retirement.retire).not.toHaveBeenCalled();
  });

  it("retries from FINALIZING and completes each retirement step exactly once", async () => {
    vi.mocked(retirement.retire).mockRejectedValueOnce(new Error("interrupted"));
    await expect(run()).rejects.toThrow("interrupted");

    await run();
    await run();

    expect(await state(DIRECT)).toMatchObject({ migrationPhase: "FINALIZED" });
    expect(await state(LEGACY)).toMatchObject({ state: "TORN_DOWN" });
    expect(commands.map(({ type }) => type)).toEqual([
      "lw.identity.begin_migration_finalization",
      "lw.identity.request_teardown",
      "lw.identity.complete_teardown",
      "lw.identity.finalize_migration",
    ]);
  });

  it("resumes after legacy teardown without reopening its callback route", async () => {
    let reads = 0;
    const original = vi.mocked(evidence.inspect).getMockImplementation();
    if (!original) throw new Error("evidence double has no implementation");
    vi.mocked(evidence.inspect).mockImplementation(async (args) => {
      reads += 1;
      if (reads === 5) throw new Error("process stopped after teardown");
      return await original(args);
    });

    await expect(run()).rejects.toThrow("process stopped after teardown");
    expect(await state(DIRECT)).toMatchObject({ migrationPhase: "FINALIZING" });
    expect(await state(LEGACY)).toMatchObject({ state: "TORN_DOWN" });

    vi.mocked(evidence.inspect).mockImplementation(original);
    await run();

    expect(await state(DIRECT)).toMatchObject({ migrationPhase: "FINALIZED" });
    expect(
      commands.filter(({ type }) => type === "lw.identity.request_teardown"),
    ).toHaveLength(1);
  });
});

async function run(): Promise<void> {
  await finalizer.finalize({
    organizationId: ORG,
    replacementConnectionId: DIRECT,
    actorUserId: ACTOR,
  });
}

async function state(connectionId: string): Promise<SsoConnectionState | null> {
  return await heads.findConnection({ connectionId });
}

function seedPair(): void {
  heads.seed({
    ...emptySsoConnection({ connectionId: LEGACY }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: ["acme.com"],
    createdAtMs: T0,
    updatedAtMs: T0,
  });
  heads.seed({
    ...emptySsoConnection({ connectionId: DIRECT }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "self-serve",
    replacesConnectionId: LEGACY,
    migrationPhase: "GRACE_DIRECT",
    verifiedDomains: ["acme.com"],
    createdAtMs: T0 + 1,
    updatedAtMs: T0 + 1,
  });
}
