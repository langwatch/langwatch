import {
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity-contract";
/**
 * @vitest-environment node
 * Editing a connection's identity provider settings over the real guards and fold,
 * from a customer report: fixing a wrong issuer meant deleting the connection.
 * @see specs/identity/sso-connection-edit-identity-provider.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import type { SsoIssuerDiscoveryChannel } from "../channels/sso-issuer-discovery.channel.ts";
import { identityRepositoriesOverMemory } from "../repositories/memory/memory.identity.repositories.ts";
import { MemoryIdentityStore } from "../repositories/memory/memory.identity.store.ts";
import type { SsoCredentialRead } from "../repositories/sso-credential.repository.ts";
import { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import { ssoConnectionHistoryCopy } from "../rules/sso-connection-history-copy.rules.ts";
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
  licensingFixture,
} from "./support/in-memory-connections.ts";

const ORG = "org_acme";
const CONNECTION = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ANA = { userId: "user_ana" };
const T0 = 1_756_000_000_000;
const WRONG = "https://login.microsoftonline.com/wrong-tenant/v2.0";
const RIGHT = "https://login.microsoftonline.com/right-tenant/v2.0";

const DOMAIN_PROOF: SsoDomainVerification = {
  domain: "acme.com",
  method: "dns-txt",
  actorId: null,
  verifiedAtMs: T0 - 1_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

/** The vault, in memory, counting what was put. */
class LocalVault extends SsoCredentialRepository {
  readonly kept = new Map<string, { kind: string; value: string }>();
  puts = 0;

  async put({ kind, value }: { kind: string; value: string }): Promise<string> {
    this.puts += 1;
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
let store: MemoryIdentityStore;
let committed: { type: string }[];
/** What the issuer's discovery document names; undefined names nothing. */
let discoveredIssuer: string | undefined;
let commands: SsoSetupCommandsService;

beforeEach(() => {
  connections = new InMemoryConnections();
  vault = new LocalVault();
  store = MemoryIdentityStore.create();
  committed = [];
  discoveredIssuer = undefined;
  const discovery: SsoIssuerDiscoveryChannel = {
    discover: async () =>
      discoveredIssuer === undefined
        ? { reachable: true }
        : { reachable: true, issuer: discoveredIssuer },
  };
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      committed.push(...facts);
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
      registrationSlots: connections,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding(),
      authorization: new StubPlatformOperators(),
      licensing: licensingFixture(),
    }),
    ledger,
  );
  commands = SsoSetupCommandsService.create({
    connections: () => connectionService,
    reads: connections,
    activity: identityRepositoriesOverMemory(store).ssoMigrationEvidence,
    credentials: vault,
    breakGlass: new StubBreakGlassBindings(true),
    passwordDoor: async () => true,
    registrations: SsoIdpRegistrationService.create({ discovery }),
    finalization: createApiFixture<SsoMigrationFinalizationService>({}),
    now: () => T0,
  });
});

async function seed(over: Partial<SsoConnectionState> = {}): Promise<SsoConnectionState> {
  const clientIdRef = await vault.put({ kind: "oidc-client-id", value: "client_old" });
  const secretRef = await vault.put({ kind: "oidc-client-secret", value: "secret_old" });
  vault.puts = 0;
  const row: SsoConnectionState = {
    ...emptySsoConnection({ connectionId: CONNECTION }),
    organizationId: ORG,
    type: "oidc",
    state: "VERIFIED",
    source: "self-serve",
    createdBy: ANA.userId,
    createdAtMs: T0,
    updatedAtMs: T0,
    verifiedDomains: ["acme.com"],
    domainVerifications: [DOMAIN_PROOF],
    arrivalPolicy: "admit",
    arrivalPolicyDecidedAtMs: T0 - 1_000,
    idpMetadata: {
      issuer: WRONG,
      providerId: "Acme Entra",
      clientIdRef,
      secretRef,
      certRefs: [],
    },
    ...over,
  };
  connections.seed(row);
  return row;
}

const current = () => connections.getConnection({ connectionId: CONNECTION });

const oidc = (
  over: Partial<{ issuer: string; clientId: string; clientSecret: string | null }> = {},
) => ({
  protocol: "oidc" as const,
  issuer: RIGHT,
  clientId: "client_new",
  clientSecret: "secret_new" as string | null,
  ...over,
});

const update = (idp: Parameters<SsoSetupCommandsService["updateIdentityProvider"]>[0]["idp"]) =>
  commands.updateIdentityProvider({
    organizationId: ORG,
    connectionId: CONNECTION,
    actor: ANA,
    idp,
  });

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(() => ({ code: "no refusal" })).catch((error: unknown) => error as { code: string });

const valueOf = (ref: string | null) =>
  ref === null ? null : (vault.kept.get(ref)?.value ?? null);

describe("editing a connection's identity provider settings", () => {
  describe("given a connection still being set up", () => {
    describe("when the administrator changes the issuer, client id and secret", () => {
      /** @scenario "Editing the identity provider keeps the connection id and redirect address" */
      it("dials the new settings on the same connection, keeping everything else", async () => {
        await seed();

        await update(oidc());

        const after = await current();
        expect(after.connectionId).toBe(CONNECTION);
        expect(after.idpMetadata.issuer).toBe(RIGHT);
        expect(after.idpMetadata.providerId).toBe("Acme Entra");
        expect(valueOf(after.idpMetadata.clientIdRef)).toBe("client_new");
        expect(valueOf(after.idpMetadata.secretRef)).toBe("secret_new");
        expect(after.verifiedDomains).toEqual(["acme.com"]);
        expect(after.arrivalPolicy).toBe("admit");
        expect(after.state).toBe("VERIFIED");
      });

      it("appends a fact that names references, never the secret", async () => {
        await seed();

        await update(oidc());

        expect(committed.map((fact) => fact.type)).toEqual([CONNECTION_IDP_UPDATED_EVENT_TYPE]);
        expect(JSON.stringify(committed)).not.toContain("secret_new");
        expect(JSON.stringify(committed)).not.toContain("client_new");
      });
    });
  });

  describe("given a live connection", () => {
    describe("when the administrator fixes the issuer", () => {
      /** @scenario "A live connection can be edited" */
      it("dials the new issuer and stays live", async () => {
        await seed({ state: "ACTIVE", testLoginAccountId: "entra|ana" });

        await update(oidc());

        const after = await current();
        expect(after.state).toBe("ACTIVE");
        expect(after.idpMetadata.issuer).toBe(RIGHT);
      });
    });

    describe("when the client secret is left blank", () => {
      /** @scenario "A blank client secret keeps the stored secret" */
      it("keeps the stored secret", async () => {
        const before = await seed({ state: "ACTIVE" });

        await update(oidc({ clientSecret: "" }));

        const after = await current();
        expect(after.idpMetadata.secretRef).toBe(before.idpMetadata.secretRef);
        expect(valueOf(after.idpMetadata.secretRef)).toBe("secret_old");
      });
    });

    describe("when the settings it already has are saved", () => {
      /** @scenario "Saving unchanged settings records nothing" */
      it("records nothing and stores no credential", async () => {
        await seed({ state: "ACTIVE" });
        discoveredIssuer = WRONG;

        await update(oidc({ issuer: WRONG, clientId: "client_old", clientSecret: null }));

        expect(vault.puts).toBe(0);
        expect(committed).toEqual([]);
      });
    });

    describe("when the discovery document names another issuer", () => {
      /** @scenario "An issuer that fails discovery is refused and nothing changes" */
      it("refuses with the issuer mismatch and changes nothing", async () => {
        const before = await seed({ state: "ACTIVE" });
        discoveredIssuer = "https://login.example.com/other";

        const refusal = await refusalOf(update(oidc()));

        expect(refusal.code).toBe("sso_issuer_mismatch");
        expect(vault.puts).toBe(0);
        expect(await current()).toEqual(before);
      });

      it("refuses an Entra ID multi-tenant issuer the way registration does", async () => {
        const before = await seed({ state: "ACTIVE" });

        const refusal = await refusalOf(
          update(oidc({ issuer: "https://login.microsoftonline.com/common/v2.0" })),
        );

        expect(refusal.code).toBe("sso_issuer_multi_tenant");
        expect(await current()).toEqual(before);
      });
    });

    describe("when SAML settings are sent for an OpenID Connect connection", () => {
      /** @scenario "The protocol cannot change on an existing connection" */
      it("refuses and changes nothing", async () => {
        const before = await seed({ state: "ACTIVE" });

        const refusal = await refusalOf(
          update({
            protocol: "saml",
            entryPoint: "https://login.acme.example/sso",
            entityId: "https://login.acme.example",
            metadataXml: null,
            certificate: null,
          }),
        );

        expect(refusal.code).toBe("sso_connection_invalid_transition");
        expect(await current()).toEqual(before);
      });
    });
  });

  describe("given a connection whose removal was requested", () => {
    /** @scenario "A connection being removed cannot be edited" */
    it("refuses and stores no credential", async () => {
      await seed({ state: "TEARDOWN_PENDING" });

      const refusal = await refusalOf(update(oidc()));

      expect(refusal.code).toBe("sso_connection_invalid_transition");
      expect((await current()).idpMetadata.issuer).toBe(WRONG);
      expect(vault.puts).toBe(0);
    });
  });

  describe("given a grandfathered connection", () => {
    it("refuses, because it has no settings of its own", async () => {
      await seed({ source: "legacy-grandfathered" });

      const refusal = await refusalOf(update(oidc()));

      expect(refusal.code).toBe("sso_connection_invalid_transition");
    });
  });

  describe("given another organization's connection", () => {
    it("answers that it does not exist", async () => {
      await seed();

      const refusal = await refusalOf(
        commands.updateIdentityProvider({
          organizationId: "org_rival",
          connectionId: CONNECTION,
          actor: ANA,
          idp: oidc(),
        }),
      );

      expect(refusal.code).toBe("sso_connection_not_found");
    });
  });

  describe("given a test sign-in through the old issuer", () => {
    const signedInThrough = (issuer: string) => {
      store.ssoAuthentications.push({
        organizationId: ORG,
        connectionId: CONNECTION,
        userId: ANA.userId,
        authenticatedAtMs: T0 - 500,
        providerAccountId: "entra|ana",
      });
      store.accounts.set(ANA.userId, [
        {
          id: "acc_ana",
          provider: CONNECTION,
          issuer,
          providerAccountId: "entra|ana",
          createdAtMs: T0 - 500,
        },
      ]);
    };

    it("counts that sign-in while the issuer is unchanged", async () => {
      await seed();
      signedInThrough(WRONG);

      await commands.activate({ organizationId: ORG, connectionId: CONNECTION, actor: ANA });

      expect((await current()).state).toBe("ACTIVE");
    });

    describe("when the administrator changes the issuer", () => {
      /** @scenario "A new issuer needs a new test sign-in before going live" */
      it("no longer counts that sign-in towards going live", async () => {
        await seed();
        signedInThrough(WRONG);

        await update(oidc());
        const refusal = await refusalOf(
          commands.activate({ organizationId: ORG, connectionId: CONNECTION, actor: ANA }),
        );

        expect(refusal.code).toBe("sso_activation_test_sign_in_missing");
      });
    });
  });
});

describe("prefilling the edit form", () => {
  describe("given an OpenID Connect connection", () => {
    it("answers the issuer and client id, and only whether a secret is stored", async () => {
      await seed();

      const view = await commands.getIdentityProvider({
        organizationId: ORG,
        connectionId: CONNECTION,
      });

      expect(view).toEqual({
        protocol: "oidc",
        issuer: WRONG,
        clientId: "client_old",
        hasClientSecret: true,
      });
      expect(JSON.stringify(view)).not.toContain("secret_old");
    });
  });

  describe("given a grandfathered connection", () => {
    it("answers that it has no settings of its own", async () => {
      await seed({ source: "legacy-grandfathered" });

      await expect(
        commands.getIdentityProvider({ organizationId: ORG, connectionId: CONNECTION }),
      ).resolves.toEqual({ protocol: "grandfathered" });
    });
  });
});

describe("the history line for an identity provider change", () => {
  /** @scenario "The change is on the connection's history" */
  it("says the settings changed and names the new issuer", () => {
    const summary = ssoConnectionHistoryCopy({
      type: CONNECTION_IDP_UPDATED_EVENT_TYPE,
      domain: null,
      method: null,
      route: null,
      policy: null,
      note: null,
      name: null,
      issuer: RIGHT,
    });

    expect(summary).toContain("identity provider settings were changed");
    expect(summary).toContain(RIGHT);
  });
});
