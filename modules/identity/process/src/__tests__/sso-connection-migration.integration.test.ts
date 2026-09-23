/**
 * @vitest-environment node
 * The legacy-to-direct cutover over the real guards and the real fold: what
 * a replacement inherits, which of the pair decides sign-ins, and the gate
 * finalization runs behind.
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import {
  emptySsoConnection,
  type SsoConnectionState,
  SsoConnectionAlreadyRegisteredError,
  SsoConnectionInvalidTransitionError,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const LEGACY = "local_ssoc_legacy0000000000000000000";
const REPLACEMENT = "local_ssoc_replacement00000000000000";
const ANA = { type: "user" as const, id: "user_ana" };
const T0 = 1_756_000_000_000;

let connections: InMemoryConnections;
let service: SsoConnectionService;
let minted = 0;

beforeEach(() => {
  minted = 0;
  connections = new InMemoryConnections();
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({ ...fact, occurredAt: command.data.occurredAtMs }));
    },
  };
  service = SsoConnectionService.create(
    SsoConnectionGuardsService.create({
      connections,
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding(),
      platformOperators: new StubPlatformOperators(),
    }),
    ledger,
  );
});

function command(connectionId: string) {
  minted += 1;
  return {
    tenantId: ORG,
    organizationId: ORG,
    connectionId,
    commandId: `cmd_${minted}`,
    occurredAtMs: T0,
    actor: ANA,
    source: "self-serve" as const,
  };
}

function seedLegacy(over: Partial<SsoConnectionState> = {}): void {
  connections.seed({
    ...emptySsoConnection({ connectionId: LEGACY }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: ["acme.com"],
    domainVerifications: [
      {
        domain: "acme.com",
        method: "legacy-configuration",
        actorId: null,
        verifiedAtMs: T0 - 10_000,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: null,
      },
    ],
    idpMetadata: {
      issuer: null,
      providerId: "auth0",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    createdAtMs: T0 - 20_000,
    updatedAtMs: T0 - 20_000,
    ...over,
  });
}

const registerReplacement = async (connectionId = REPLACEMENT) =>
  await service.registerReplacementConnection({
    ...command(connectionId),
    type: "oidc",
    idp: {
      issuer: "https://acme.okta.com",
      providerId: "acme-okta",
      clientIdRef: "cred_1",
      secretRef: "cred_2",
      certRefs: [],
    },
    arrivalPolicy: "refuse",
    replacesConnectionId: LEGACY,
  });

async function liveReplacement(): Promise<void> {
  seedLegacy();
  await registerReplacement();
  const held = await connections.tryFindConnection({ connectionId: REPLACEMENT });
  if (!held) throw new Error("the replacement was not registered");
  connections.seed({ ...held, state: "ACTIVE" });
}

describe("given a grandfathered connection an organization is moving off", () => {
  describe("when the direct replacement is registered", () => {
    it("carries over the domains the customer already proved", async () => {
      seedLegacy();

      await registerReplacement();

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.verifiedDomains).toEqual(["acme.com"]);
      expect(state?.state).toBe("VERIFIED");
      expect(state?.replacesConnectionId).toBe(LEGACY);
      expect(state?.migrationPhase).toBe("SETUP");
    });

    it("leaves a domain whose evidence has lapsed behind", async () => {
      seedLegacy({
        domainVerifications: [
          {
            domain: "acme.com",
            method: "dns-txt",
            actorId: "user_ana",
            verifiedAtMs: T0 - 10_000,
            proofState: "LAPSED",
            firstAbsentAtMs: T0 - 9_000,
            graceEndsAtMs: T0 - 1_000,
            tokenHash: "sha256:gone",
          },
        ],
      });

      await registerReplacement();

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.verifiedDomains).toEqual([]);
      expect(state?.state).toBe("DRAFT");
    });

    it("states nothing the second time the same registration arrives", async () => {
      seedLegacy();
      await registerReplacement();

      const facts = await registerReplacement();

      expect(facts).toEqual([]);
    });

    it("refuses an id another connection already holds", async () => {
      seedLegacy();
      connections.seed({
        ...emptySsoConnection({ connectionId: REPLACEMENT }),
        organizationId: ORG,
        state: "DRAFT",
        source: "self-serve",
      });

      await expect(registerReplacement()).rejects.toBeInstanceOf(
        SsoConnectionAlreadyRegisteredError,
      );
    });

    it("refuses a second replacement while the first one stands", async () => {
      seedLegacy();
      await registerReplacement();

      await expect(
        registerReplacement("local_ssoc_second0000000000000000000"),
      ).rejects.toBeInstanceOf(SsoConnectionAlreadyRegisteredError);
    });

    it("refuses a predecessor that is not an active grandfathered connection", async () => {
      seedLegacy({ source: "self-serve" });

      await expect(registerReplacement()).rejects.toBeInstanceOf(
        SsoConnectionInvalidTransitionError,
      );
    });
  });

  describe("when the administrator chooses which connection decides sign-ins", () => {
    /** @scenario "Migration routing waits for the replacement to be active" */
    it("refuses until the replacement is live, and allows it once it is", async () => {
      seedLegacy();
      await registerReplacement();

      await expect(
        service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" }),
      ).rejects.toBeInstanceOf(SsoConnectionInvalidTransitionError);

      const held = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      if (!held) throw new Error("the replacement was not registered");
      connections.seed({ ...held, state: "ACTIVE" });
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.migrationPhase).toBe("GRACE_DIRECT");
    });

    it("moves the pair into the grace the choice names", async () => {
      await liveReplacement();

      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.migrationPhase).toBe("GRACE_DIRECT");
      expect(state?.graceStartedAtMs).toBe(T0);
      expect(state?.routeChangedAtMs).toBe(T0);
    });

    it("costs no fact when it names the route the pair already runs", async () => {
      await liveReplacement();
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "legacy" });

      const facts = await service.selectMigrationRoute({
        ...command(REPLACEMENT),
        route: "legacy",
      });

      expect(facts).toEqual([]);
    });

    it("refuses on a connection that replaces nothing", async () => {
      connections.seed({
        ...emptySsoConnection({ connectionId: REPLACEMENT }),
        organizationId: ORG,
        state: "ACTIVE",
        source: "self-serve",
      });

      await expect(
        service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" }),
      ).rejects.toBeInstanceOf(SsoConnectionInvalidTransitionError);
    });
  });

  describe("when the old connection is retired", () => {
    it("refuses to open the gate before the direct route is chosen", async () => {
      await liveReplacement();

      await expect(service.beginMigrationFinalization(command(REPLACEMENT))).rejects.toBeInstanceOf(
        SsoConnectionInvalidTransitionError,
      );
    });

    it("opens the gate once, and says so again without a second fact", async () => {
      await liveReplacement();
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });

      await service.beginMigrationFinalization(command(REPLACEMENT));
      const again = await service.beginMigrationFinalization(command(REPLACEMENT));

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.migrationPhase).toBe("FINALIZING");
      expect(state?.finalizationRequestedAtMs).toBe(T0);
      expect(again).toEqual([]);
    });

    it("refuses to finalize a migration that never entered finalization", async () => {
      await liveReplacement();
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });

      await expect(service.finalizeMigration(command(REPLACEMENT))).rejects.toBeInstanceOf(
        SsoConnectionInvalidTransitionError,
      );
    });

    it("locks the route once finalization has begun", async () => {
      await liveReplacement();
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });
      await service.beginMigrationFinalization(command(REPLACEMENT));

      await expect(
        service.selectMigrationRoute({ ...command(REPLACEMENT), route: "legacy" }),
      ).rejects.toBeInstanceOf(SsoConnectionInvalidTransitionError);
    });

    it("finalizes through the gate", async () => {
      await liveReplacement();
      await service.selectMigrationRoute({ ...command(REPLACEMENT), route: "direct" });
      await service.beginMigrationFinalization(command(REPLACEMENT));

      await service.finalizeMigration(command(REPLACEMENT));

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.migrationPhase).toBe("FINALIZED");
      expect(state?.finalizedAtMs).toBe(T0);
    });
  });

  describe("when the connection is renamed", () => {
    it("says the new name on the card and nothing else", async () => {
      await liveReplacement();

      await service.renameConnection({ ...command(REPLACEMENT), name: "  Okta  " });

      const state = await connections.tryFindConnection({ connectionId: REPLACEMENT });
      expect(state?.idpMetadata.providerId).toBe("Okta");
      expect(state?.idpMetadata.issuer).toBe("https://acme.okta.com");
    });

    it("costs no fact when the name is the one it already has", async () => {
      await liveReplacement();

      const facts = await service.renameConnection({
        ...command(REPLACEMENT),
        name: "acme-okta",
      });

      expect(facts).toEqual([]);
    });
  });
});

describe("given a grandfathered connection an organization is still running", () => {
  beforeEach(() => seedLegacy());

  /** @scenario "A legacy connection may have exactly one explicit direct replacement" */
  it("refuses the ordinary lower-level registration bypass beside legacy", async () => {
    await expect(
      service.registerConnection({
        ...command("local_ssoc_unlinked000000000000000"),
        type: "oidc",
        idp: {
          issuer: "https://acme.okta.com",
          providerId: "acme-okta",
          clientIdRef: "cred_1",
          secretRef: "cred_2",
          certRefs: [],
        },
        arrivalPolicy: "refuse",
      }),
    ).rejects.toMatchObject({ code: "sso_connection_already_registered" });

    expect(
      await connections.tryFindConnection({ connectionId: "local_ssoc_unlinked000000000000000" }),
    ).toBeNull();
  });

  it("serializes concurrent replacement attempts before either event is appended", async () => {
    const attempts = await Promise.allSettled([
      registerReplacement("local_ssoc_candidate_a000000000000"),
      registerReplacement("local_ssoc_candidate_b000000000000"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
  });

  it("reuses the direct slot after the prior draft is discarded", async () => {
    await registerReplacement();
    await service.discardConnection(command(REPLACEMENT));

    await registerReplacement("local_ssoc_replacement_retry000000");

    expect(
      await connections.tryFindConnection({ connectionId: "local_ssoc_replacement_retry000000" }),
    ).toMatchObject({ migrationPhase: "SETUP", replacesConnectionId: LEGACY });
  });
});
