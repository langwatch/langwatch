import type { Encryption } from "@langwatch/process-stores/members";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../memory/memory.identity.store.ts";
import { MemorySsoCredentialRepository } from "../memory/memory.sso-credential.repository.ts";
import {
  type PrismaSsoCredentialDatabase,
  PrismaSsoCredentialRepository,
} from "../prisma/prisma.sso-credential.repository.ts";
import type { SsoCredentialRepository } from "../sso-credential.repository.ts";

/**
 * The vault a connection's credential references point at (D09). Both tiers
 * are asserted through one set of cases, because a twin that answered
 * differently would let a test pass against behaviour production never has.
 */

const ORG = "org_acme";
const OTHER_ORG = "org_globex";
const CONNECTION = "ssoc_acme";

type Row = {
  id: string;
  organizationId: string;
  connectionId: string;
  kind: string;
  ciphertext: string;
};

/** Reversible, so a sealed value is observably not the plaintext. */
const reversingCipher: Encryption = {
  encrypt: (plaintext) => `sealed:${Buffer.from(plaintext, "utf8").toString("base64")}`,
  decrypt: (ciphertext) => {
    if (!ciphertext.startsWith("sealed:")) throw new Error("not sealed by this key");

    return Buffer.from(ciphertext.slice("sealed:".length), "base64").toString("utf8");
  },
};

/** The one delegate, written to the repository's own narrow store type —
 *  nothing else is reachable from here, so nothing else can be read. */
function stubDatabase(rows: Row[]): PrismaSsoCredentialDatabase {
  return {
    ssoCredential: {
      async create({ data }) {
        rows.push(data);

        return data;
      },
      async findFirst({ where }) {
        return (
          rows.find((row) => row.id === where.id && row.organizationId === where.organizationId) ??
          null
        );
      },
    },
  };
}

const tiers: { name: string; build: () => SsoCredentialRepository }[] = [
  {
    name: "the memory twin",
    build: () => MemorySsoCredentialRepository.create(MemoryIdentityStore.create()),
  },
  {
    name: "the Postgres vault",
    build: () => PrismaSsoCredentialRepository.create(stubDatabase([]), reversingCipher),
  },
];

describe.each(tiers)("$name", ({ build }) => {
  it("answers the reference a write minted, and reads the value back through it", async () => {
    const credentials = build();

    const ref = await credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind: "oidc-client-secret",
      value: "s3cr3t",
    });

    expect(ref).not.toContain("s3cr3t");
    await expect(credentials.read({ organizationId: ORG, ref })).resolves.toEqual({
      found: true,
      value: "s3cr3t",
    });
  });

  /** @scenario "A credential belongs to the organization that stored it" */
  it("refuses another organization's reference rather than trusting it to be unguessable", async () => {
    const credentials = build();
    const ref = await credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind: "oidc-client-id",
      value: "client-abc",
    });

    await expect(credentials.read({ organizationId: OTHER_ORG, ref })).resolves.toEqual({
      found: false,
    });
  });

  it("mints a new reference per write, so rotating leaves the old one readable", async () => {
    const credentials = build();
    const first = await credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind: "oidc-client-secret",
      value: "old",
    });

    const second = await credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind: "oidc-client-secret",
      value: "new",
    });

    expect(second).not.toBe(first);
    await expect(credentials.read({ organizationId: ORG, ref: first })).resolves.toEqual({
      found: true,
      value: "old",
    });
    await expect(credentials.read({ organizationId: ORG, ref: second })).resolves.toEqual({
      found: true,
      value: "new",
    });
  });

  it("answers a reference nothing was ever written under as absent", async () => {
    const credentials = build();

    await expect(
      credentials.read({ organizationId: ORG, ref: "ssocred_nothing" }),
    ).resolves.toEqual({ found: false });
  });
});

describe("the Postgres vault's sealing", () => {
  /** @scenario "A stored credential is unreadable without the deployment's key" */
  it("stores no plaintext, whatever the row is asked for afterwards", async () => {
    const rows: Row[] = [];
    const credentials = PrismaSsoCredentialRepository.create(stubDatabase(rows), reversingCipher);

    await credentials.put({
      organizationId: ORG,
      connectionId: CONNECTION,
      kind: "oidc-client-secret",
      value: "s3cr3t",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.ciphertext).not.toContain("s3cr3t");
  });

  it("answers a row the current key cannot open as absent, not as a failure", async () => {
    const rows: Row[] = [
      {
        id: "ssocred_rotated",
        organizationId: ORG,
        connectionId: CONNECTION,
        kind: "oidc-client-secret",
        ciphertext: "written-under-a-key-that-is-gone",
      },
    ];
    const credentials = PrismaSsoCredentialRepository.create(stubDatabase(rows), reversingCipher);

    await expect(
      credentials.read({ organizationId: ORG, ref: "ssocred_rotated" }),
    ).resolves.toEqual({ found: false });
  });
});
