import {
  emptySsoConnection,
  qualifySsoDomainOwnership,
  type SsoConnectionCommand,
  type SsoConnectionState,
} from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
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
const T0 = 1_756_000_000_000;
const ACTOR = { type: "user" as const, id: "user_admin" };
const IDP = {
  issuer: "https://acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [] as string[],
};

const commandIdentity = (connectionId: string, occurredAtMs: number) => ({
  tenantId: ORG,
  organizationId: ORG,
  connectionId,
  commandId: `command_${connectionId}_${occurredAtMs}`,
  occurredAtMs,
  actor: ACTOR,
  source: "self-serve" as const,
});

let connections: InMemoryConnections;
let committed: SsoConnectionCommand[];
let service: SsoConnectionService;

beforeEach(() => {
  connections = new InMemoryConnections();
  committed = [];
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      committed.push(command);
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({
        ...fact,
        occurredAt: command.data.occurredAtMs,
      }));
    },
  };
  service = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      platformOperators: new StubPlatformOperators([]),
      licenseAuthority: new StubLicenseAuthority(),
    }),
    ledger,
  );
  connections.seed(legacyConnection());
});

describe("Auth0 connection migration lifecycle", () => {
  it("inherits an exact legacy-import proof without resetting its evidence", async () => {
    const imported = legacyImportProof();
    connections.seed({
      ...legacyConnection(),
      domainVerifications: [imported],
    });

    await service.registerReplacementConnection({
      ...commandIdentity(DIRECT, T0 + 1),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });

    const replacement = await held(DIRECT);
    expect(replacement).toMatchObject({
      state: "VERIFIED",
      verifiedDomains: ["acme.com"],
      domainVerifications: [imported],
    });
    expect(
      qualifySsoDomainOwnership({
        state: replacement!,
        domain: "acme.com",
      }).status,
    ).toBe("QUALIFIED");
  });

  it("does not inherit a legacy method with missing import provenance", async () => {
    connections.seed({
      ...legacyConnection(),
      domainVerifications: [{ ...legacyImportProof(), legacyImport: null }],
    });

    await service.registerReplacementConnection({
      ...commandIdentity(DIRECT, T0 + 1),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });

    expect(await held(DIRECT)).toMatchObject({
      state: "DRAFT",
      verifiedDomains: [],
      domainVerifications: [],
    });
  });

  it("inherits only a qualified predecessor proof without resetting its evidence age", async () => {
    const verifiedAtMs = T0 - 30 * 24 * 60 * 60 * 1000;
    connections.seed({
      ...legacyConnection(),
      domainVerifications: [
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: "user_operator",
          verifiedAtMs,
          proofState: "WAVERING",
          firstAbsentAtMs: T0 - 1_000,
          graceEndsAtMs: T0 + 1_000,
          tokenHash: null,
          evidenceRef: "support-case:SSO-42",
          note: "Matched the signed customer request to the domain registry.",
          verifier: { type: "user", id: "user_operator" },
        },
      ],
    });

    await service.registerReplacementConnection({
      ...commandIdentity(DIRECT, T0 + 1),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });

    expect(await held(DIRECT)).toMatchObject({
      state: "VERIFIED",
      verifiedDomains: ["acme.com"],
      domainVerifications: [
        {
          domain: "acme.com",
          verifiedAtMs,
          proofState: "WAVERING",
          firstAbsentAtMs: T0 - 1_000,
          graceEndsAtMs: T0 + 1_000,
          evidenceRef: "support-case:SSO-42",
        },
      ],
    });
  });

  /** @scenario "A legacy connection may have exactly one explicit direct replacement" */
  it("registers one explicit replacement and refuses a third connection", async () => {
    await service.registerReplacementConnection({
      ...commandIdentity(DIRECT, T0 + 1),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });

    expect(await held(DIRECT)).toMatchObject({
      replacesConnectionId: LEGACY,
      migrationPhase: "SETUP",
      graceStartedAtMs: null,
      routeChangedAtMs: null,
    });
    await expect(
      service.registerReplacementConnection({
        ...commandIdentity("ssoc_third", T0 + 2),
        type: "oidc",
        idp: IDP,
        arrivalPolicy: "refuse",
        replacesConnectionId: LEGACY,
      }),
    ).rejects.toMatchObject({ code: "sso_connection_already_registered" });
  });

  /** @scenario "A legacy connection may have exactly one explicit direct replacement" */
  it("refuses the ordinary lower-level registration bypass beside legacy", async () => {
    await expect(
      service.registerConnection({
        ...commandIdentity("ssoc_unlinked", T0 + 1),
        type: "oidc",
        idp: IDP,
        arrivalPolicy: "refuse",
      }),
    ).rejects.toMatchObject({ code: "sso_connection_already_registered" });

    expect(await held("ssoc_unlinked")).toBeNull();
  });

  it("serializes concurrent replacement attempts before either event is appended", async () => {
    const attempts = await Promise.allSettled([
      service.registerReplacementConnection({
        ...commandIdentity("ssoc_candidate_a", T0 + 1),
        type: "oidc",
        idp: IDP,
        arrivalPolicy: "refuse",
        replacesConnectionId: LEGACY,
      }),
      service.registerReplacementConnection({
        ...commandIdentity("ssoc_candidate_b", T0 + 1),
        type: "oidc",
        idp: IDP,
        arrivalPolicy: "refuse",
        replacesConnectionId: LEGACY,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(
      1,
    );
    expect(
      committed.filter(
        (command) =>
          command.type === "lw.identity.register_replacement_connection",
      ),
    ).toHaveLength(1);
  });

  it("reuses the direct slot after the prior draft is discarded", async () => {
    await service.registerReplacementConnection({
      ...commandIdentity(DIRECT, T0 + 1),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });
    await service.discardConnection(commandIdentity(DIRECT, T0 + 2));

    await service.registerReplacementConnection({
      ...commandIdentity("ssoc_replacement_retry", T0 + 3),
      type: "oidc",
      idp: IDP,
      arrivalPolicy: "refuse",
      replacesConnectionId: LEGACY,
    });

    expect(await held("ssoc_replacement_retry")).toMatchObject({
      migrationPhase: "SETUP",
      replacesConnectionId: LEGACY,
    });
  });

  it("persists route choices, supports rollback, and finalizes explicitly", async () => {
    await registerActiveReplacement();

    await service.selectMigrationRoute({
      ...commandIdentity(DIRECT, T0 + 10),
      route: "legacy",
    });
    await service.selectMigrationRoute({
      ...commandIdentity(DIRECT, T0 + 20),
      route: "direct",
    });
    await service.selectMigrationRoute({
      ...commandIdentity(DIRECT, T0 + 30),
      route: "legacy",
    });
    await service.selectMigrationRoute({
      ...commandIdentity(DIRECT, T0 + 40),
      route: "direct",
    });
    await service.beginMigrationFinalization(
      commandIdentity(DIRECT, T0 + 50),
    );
    await service.finalizeMigration(commandIdentity(DIRECT, T0 + 60));

    expect(await held(DIRECT)).toMatchObject({
      migrationPhase: "FINALIZED",
      graceStartedAtMs: T0 + 10,
      routeChangedAtMs: T0 + 40,
      finalizationRequestedAtMs: T0 + 50,
      finalizedAtMs: T0 + 60,
    });
    expect(committed.map((command) => command.type)).toEqual([
      "lw.identity.register_replacement_connection",
      "lw.identity.select_migration_route",
      "lw.identity.select_migration_route",
      "lw.identity.select_migration_route",
      "lw.identity.select_migration_route",
      "lw.identity.begin_migration_finalization",
      "lw.identity.finalize_migration",
    ]);
  });

  it("does not infer route changes from later timestamps", async () => {
    await registerActiveReplacement();
    await service.selectMigrationRoute({
      ...commandIdentity(DIRECT, T0 + 10),
      route: "direct",
    });
    await service.setArrivalPolicy({
      ...commandIdentity(DIRECT, T0 + 100),
      policy: "admit",
    });

    expect(await held(DIRECT)).toMatchObject({
      migrationPhase: "GRACE_DIRECT",
      routeChangedAtMs: T0 + 10,
      updatedAtMs: T0 + 100,
    });
  });

  it("makes repeated lifecycle commands idempotent", async () => {
    await registerActiveReplacement();
    const select = { ...commandIdentity(DIRECT, T0 + 10), route: "direct" as const };
    await service.selectMigrationRoute(select);
    expect(await service.selectMigrationRoute(select)).toEqual([]);

    const begin = commandIdentity(DIRECT, T0 + 20);
    await service.beginMigrationFinalization(begin);
    expect(await service.beginMigrationFinalization(begin)).toEqual([]);

    const finalize = commandIdentity(DIRECT, T0 + 30);
    await service.finalizeMigration(finalize);
    expect(await service.finalizeMigration(finalize)).toEqual([]);
  });
});

async function registerActiveReplacement(): Promise<void> {
  await service.registerReplacementConnection({
    ...commandIdentity(DIRECT, T0 + 1),
    type: "oidc",
    idp: IDP,
    arrivalPolicy: "refuse",
    replacesConnectionId: LEGACY,
  });
  const state = await held(DIRECT);
  if (!state) throw new Error("replacement was not registered");
  connections.seed({ ...state, state: "ACTIVE" });
}

async function held(connectionId: string): Promise<SsoConnectionState | null> {
  return connections.findConnection({ connectionId });
}

function legacyConnection(): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: LEGACY }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: ["acme.com"],
    createdAtMs: T0,
    updatedAtMs: T0,
  };
}

function legacyImportProof(): SsoConnectionState["domainVerifications"][number] {
  return {
    domain: "acme.com",
    method: "legacy-configuration",
    actorId: null,
    verifiedAtMs: T0,
    proofState: "VERIFIED",
    firstAbsentAtMs: null,
    graceEndsAtMs: null,
    tokenHash: null,
    evidenceRef: `legacy-sso-config:${ORG}:${LEGACY}:acme.com`,
    note: null,
    verifier: { type: "system", id: null },
    legacyImport: {
      migration: "sso-connection-grandfather-v1",
      version: 1,
      organizationId: ORG,
      predecessorConnectionId: LEGACY,
      domain: "acme.com",
      importedAtMs: T0,
      evidenceRef: `legacy-sso-config:${ORG}:${LEGACY}:acme.com`,
    },
  };
}
