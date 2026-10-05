import { sealedProviderConfigCipher } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import type { SsoEngineProviderRow } from "../../rules/sso-engine-provider.rules.ts";
import { MemoryIdentityStore } from "../memory/memory.identity.store.ts";
import { MemorySsoEngineProviderRepository } from "../memory/memory.sso-engine-provider.repository.ts";
import {
  type PrismaSsoEngineProviderDatabase,
  PrismaSsoEngineProviderRepository,
} from "../prisma/prisma.sso-engine-provider.repository.ts";
import type { SsoEngineProviderRepository } from "../sso-engine-provider.repository.ts";

/**
 * Whether the engine holds a provider for a connection (D09), asserted
 * through one set of cases against both tiers: a twin that answered
 * differently would make a connection dialable in a test and nowhere else.
 */

const CONNECTION = "ssoc_acme";

function row(connectionId: string): SsoEngineProviderRow {
  return {
    id: connectionId,
    providerId: connectionId,
    organizationId: "org_acme",
    issuer: "https://idp.acme.example",
    domain: "acme.example",
    oidcConfig: "{}",
    samlConfig: null,
  };
}

/** A reversible stand-in for the deployment's cipher. */
const encryption = {
  encrypt: (plaintext: string) => Buffer.from(plaintext).toString("base64"),
  decrypt: (ciphertext: string) => Buffer.from(ciphertext, "base64").toString("utf8"),
};

/** The one delegate, over a map: enough of it for the three verbs. */
function stubDatabase(written: Map<string, unknown> = new Map()): PrismaSsoEngineProviderDatabase {
  const rows = new Map<string, { id: string }>();

  return {
    ssoProvider: {
      upsert: async ({ where, create }) => {
        rows.set(where.id, { id: create.id });
        written.set(where.id, create);

        return create;
      },
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
      deleteMany: async ({ where }) => ({ count: rows.delete(where.id) ? 1 : 0 }),
    },
  };
}

const tiers: { name: string; build: () => SsoEngineProviderRepository }[] = [
  {
    name: "memory",
    build: () => MemorySsoEngineProviderRepository.create(MemoryIdentityStore.create()),
  },
  {
    name: "prisma",
    build: () => PrismaSsoEngineProviderRepository.create(stubDatabase(), encryption),
  },
];

describe.each(tiers)("SsoEngineProviderRepository ($name)", ({ build }) => {
  describe("findRegisteredProvider()", () => {
    it("answers no for a connection nothing was ever registered for", async () => {
      const repository = build();

      await expect(repository.findRegisteredProvider({ connectionId: CONNECTION })).resolves.toBe(
        false,
      );
    });

    it("answers yes once the fold wrote the connection's row", async () => {
      const repository = build();
      await repository.put(row(CONNECTION));

      await expect(repository.findRegisteredProvider({ connectionId: CONNECTION })).resolves.toBe(
        true,
      );
    });

    it("answers no again once the row is removed", async () => {
      const repository = build();
      await repository.put(row(CONNECTION));
      await repository.remove({ connectionId: CONNECTION });

      await expect(repository.findRegisteredProvider({ connectionId: CONNECTION })).resolves.toBe(
        false,
      );
    });

    it("answers for the connection asked about and no other", async () => {
      const repository = build();
      await repository.put(row(CONNECTION));

      await expect(
        repository.findRegisteredProvider({ connectionId: "ssoc_globex" }),
      ).resolves.toBe(false);
    });
  });
});

describe("given the live tier writes a connection's dialing document", () => {
  it("keeps the client secret out of the row at rest", async () => {
    const written = new Map<string, unknown>();
    const repository = PrismaSsoEngineProviderRepository.create(stubDatabase(written), encryption);
    const document = JSON.stringify({ clientId: "client-1", clientSecret: "shhh" });

    await repository.put({ ...row(CONNECTION), oidcConfig: document });

    const stored = written.get(CONNECTION) as { oidcConfig: string; samlConfig: null };
    expect(stored.oidcConfig).not.toContain("shhh");
    expect(sealedProviderConfigCipher(encryption).open(stored.oidcConfig)).toBe(document);
    expect(stored.samlConfig).toBeNull();
  });
});
