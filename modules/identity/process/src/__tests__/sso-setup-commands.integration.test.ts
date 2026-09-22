/**
 * @vitest-environment node
 * The verbs the setup journey presses, over the real guards and the real
 * fold: what reaches the vault, what reaches the fact, and which removal a
 * press sends.
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  emptySsoConnection,
  type SsoConnectionState,
  SsoConnectionNotFoundError,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../repositories/memory/memory-identity.store.ts";
import { MemoryIdentityRepositories } from "../repositories/memory/memory.identity.repositories.ts";
import type { SsoCredentialRead } from "../repositories/sso-credential.repository.ts";
import { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import { SsoConnectionGuardsService } from "../services/sso-connection-guards.service.ts";
import { SsoConnectionService } from "../services/sso-connection.service.ts";
import { SsoIdpRegistrationService } from "../services/sso-idp-registration.service.ts";
import type { SsoMigrationFinalizationService } from "../services/sso-migration-finalization.service.ts";
import { SsoSetupCommandsService } from "../services/sso-setup-commands.service.ts";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const OTHER_ORG = "org_rival";
const CONNECTION = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ANA = { userId: "user_ana" };
const T0 = 1_756_000_000_000;

/** Base64 that decodes to a DER SEQUENCE, which is all a certificate has to
 *  be at registration: whether the key signs is a sign-in's question. */
const CERTIFICATE = Buffer.concat([
  Buffer.from([0x30, 0x82, 0x01, 0x00]),
  Buffer.alloc(252, 0x41),
]).toString("base64");

/** The vault, in memory: what was kept, under the reference handed back. */
class LocalVault extends SsoCredentialRepository {
  readonly kept = new Map<string, { kind: string; value: string }>();

  async put({
    kind,
    value,
  }: {
    organizationId: string;
    connectionId: string;
    kind: string;
    value: string;
  }): Promise<string> {
    const ref = `cred_${this.kept.size + 1}`;
    this.kept.set(ref, { kind, value });
    return ref;
  }

  async read({ ref }: { organizationId: string; ref: string }): Promise<SsoCredentialRead> {
    const held = this.kept.get(ref);
    return held ? { found: true, value: held.value } : { found: false };
  }
}

let connections: InMemoryConnections;
let vault: LocalVault;
let commands: SsoSetupCommandsService;

/** An issuer that answers as one, so registration turns on what was typed. */
const reachableDiscovery = { discover: async () => ({ reachable: true as const }) };

beforeEach(() => {
  connections = new InMemoryConnections();
  vault = new LocalVault();
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
  const connectionService = SsoConnectionService.create(
    SsoConnectionGuardsService.create({
      connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding(),
      platformOperators: new StubPlatformOperators(),
    }),
    ledger,
  );
  commands = SsoSetupCommandsService.create({
    connections: () => connectionService,
    reads: connections,
    activity: MemoryIdentityRepositories.over(MemoryIdentityStore.create()).ssoMigrationEvidence,
    credentials: vault,
    registrations: SsoIdpRegistrationService.create({ discovery: reachableDiscovery }),
    finalization: createApiFixture<SsoMigrationFinalizationService>({}),
    now: () => T0,
  });
});

function seed(over: Partial<SsoConnectionState> = {}): void {
  connections.seed({
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    state: "VERIFIED",
    source: "self-serve",
    createdBy: ANA.userId,
    createdAtMs: T0,
    updatedAtMs: T0,
    ...over,
  });
}

describe("given an administrator registering their identity provider", () => {
  describe("when it speaks openid connect", () => {
    it("keeps both credentials in the vault and names only their references in the fact", async () => {
      const { connectionId } = await commands.register({
        organizationId: ORG,
        actor: ANA,
        providerId: "acme-okta",
        registration: {
          protocol: "oidc",
          issuer: "https://idp.example",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      });

      const state = await connections.tryFindConnection({ connectionId });
      expect(state?.idpMetadata).toMatchObject({
        issuer: "https://idp.example",
        providerId: "acme-okta",
        clientIdRef: "cred_1",
        secretRef: "cred_2",
      });
      expect(JSON.stringify(state)).not.toContain("client-secret");
      expect(vault.kept.get("cred_2")).toEqual({
        kind: "oidc-client-secret",
        value: "client-secret",
      });
    });

    it("turns everybody away until somebody decides who it admits", async () => {
      const { connectionId } = await commands.register({
        organizationId: ORG,
        actor: ANA,
        providerId: "acme-okta",
        registration: {
          protocol: "oidc",
          issuer: "https://idp.example",
          clientId: "client-id",
          clientSecret: "client-secret",
        },
      });

      const state = await connections.tryFindConnection({ connectionId });
      expect(state?.arrivalPolicy).toBe("refuse");
      expect(state?.arrivalPolicyDecidedAtMs).toBeNull();
    });
  });

  describe("when it speaks saml", () => {
    it("keeps the dialing document whole, under one reference", async () => {
      const { connectionId } = await commands.register({
        organizationId: ORG,
        actor: ANA,
        providerId: "acme-saml",
        registration: {
          protocol: "saml",
          entryPoint: "https://idp.example/sso",
          entityId: "urn:acme",
          metadataXml: null,
          certificate: CERTIFICATE,
        },
      });

      const state = await connections.tryFindConnection({ connectionId });
      expect(state?.idpMetadata.certRefs).toEqual(["cred_1"]);
      expect(state?.idpMetadata.issuer).toBe("urn:acme");
      expect(vault.kept.get("cred_1")?.kind).toBe("saml-idp-config");
    });

    it("refuses a registration carrying neither metadata nor an entity id", async () => {
      await expect(
        commands.register({
          organizationId: ORG,
          actor: ANA,
          providerId: "acme-saml",
          registration: {
            protocol: "saml",
            entryPoint: "https://idp.example/sso",
            entityId: null,
            metadataXml: null,
            certificate: null,
          },
        }),
      ).rejects.toMatchObject({ code: "sso_credentials_required" });
      expect(vault.kept.size).toBe(0);
    });
  });
});

describe("given a connection somebody presses remove on", () => {
  describe("when it is still being set up", () => {
    /** @scenario "An administrator removes their own connection that never went live" */
    it("is discarded outright", async () => {
      seed();

      await expect(
        commands.removeConnection({
          organizationId: ORG,
          connectionId: CONNECTION,
          actor: ANA,
          reason: null,
          graceMs: 86_400_000,
        }),
      ).resolves.toEqual({ removal: "discarded" });
      expect((await connections.tryFindConnection({ connectionId: CONNECTION }))?.state).toBe(
        "DISCARDED",
      );
    });
  });

  describe("when it is deciding sign-ins", () => {
    /** @scenario "An administrator removes their own live connection on teardown's terms" */
    it("is torn down after a grace, so a press locks nobody out", async () => {
      seed({ state: "ACTIVE", verifiedDomains: ["acme.com"], testLoginAccountId: "acc_test" });

      await expect(
        commands.removeConnection({
          organizationId: ORG,
          connectionId: CONNECTION,
          actor: ANA,
          reason: "moving providers",
          graceMs: 86_400_000,
        }),
      ).resolves.toEqual({ removal: "teardown-requested" });
      const state = await connections.tryFindConnection({ connectionId: CONNECTION });
      expect(state?.state).toBe("TEARDOWN_PENDING");
      expect(state?.tearDownAfterMs).toBe(T0 + 86_400_000);
    });
  });

  describe("when it is already being removed", () => {
    /** @scenario "Asking again while a removal waits brings the date forward" */
    it("re-derives the deadline from the new ask, and never discards", async () => {
      seed({ state: "ACTIVE", verifiedDomains: ["acme.com"], testLoginAccountId: "acc_test" });
      const ask = {
        organizationId: ORG,
        connectionId: CONNECTION,
        actor: ANA,
        reason: null,
      };
      await commands.removeConnection({ ...ask, graceMs: 604_800_000 });

      await expect(commands.removeConnection({ ...ask, graceMs: 3_600_000 })).resolves.toEqual({
        removal: "teardown-requested",
      });
      const state = await connections.tryFindConnection({ connectionId: CONNECTION });
      expect(state?.state).toBe("TEARDOWN_PENDING");
      expect(state?.tearDownAfterMs).toBe(T0 + 3_600_000);
    });
  });

  describe("when it belongs to another organization", () => {
    /** @scenario "An administrator removes their own live connection on teardown's terms" */
    it("is refused in the words a connection that does not exist is", async () => {
      seed({ organizationId: OTHER_ORG });

      await expect(
        commands.removeConnection({
          organizationId: ORG,
          connectionId: CONNECTION,
          actor: ANA,
          reason: null,
          graceMs: 86_400_000,
        }),
      ).rejects.toBeInstanceOf(SsoConnectionNotFoundError);
    });
  });
});

describe("given an administrator deciding who a connection admits", () => {
  it("records the decision, and that somebody made it", async () => {
    seed();

    await commands.setArrivals({
      organizationId: ORG,
      connectionId: CONNECTION,
      actor: ANA,
      arrivalPolicy: "request",
    });

    const state = await connections.tryFindConnection({ connectionId: CONNECTION });
    expect(state?.arrivalPolicy).toBe("request");
    expect(state?.arrivalPolicyDecidedAtMs).toBe(T0);
  });
});
