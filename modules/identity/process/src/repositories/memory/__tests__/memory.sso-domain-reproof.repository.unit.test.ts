/**
 * Spec: specs/identity/sso-domain-verification.feature
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../memory-identity.store.ts";
import { MemorySsoDomainReproofTargetRepository } from "../memory.sso-domain-reproof.repository.ts";

const T0 = 1_725_000_000_000;

let store: MemoryIdentityStore;
let repository: MemorySsoDomainReproofTargetRepository;

function seed(connectionId: string, domain: string, overrides: Partial<SsoConnectionState> = {}) {
  store.ssoConnections.set(connectionId, {
    ...emptySsoConnection({ connectionId }),
    organizationId: `org_${connectionId}`,
    state: "ACTIVE",
    verifiedDomains: [domain],
    domainVerifications: [
      {
        domain,
        method: "https-file",
        actorId: "user_admin",
        verifiedAtMs: T0,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: `sha256:${domain}`,
      },
    ],
    ...overrides,
  });
}

describe("MemorySsoDomainReproofTargetRepository", () => {
  beforeEach(() => {
    store = MemoryIdentityStore.create();
    repository = MemorySsoDomainReproofTargetRepository.create(store);
  });

  describe("given three proved connections and one look already stamped", () => {
    /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
    it("hands out the connection nobody has looked at before the one looked at longest ago", async () => {
      seed("ssoc_a", "a.example");
      seed("ssoc_b", "b.example");
      seed("ssoc_c", "c.example");
      await repository.markSwept({ connectionIds: ["ssoc_a"], atMs: T0 });
      await repository.markSwept({ connectionIds: ["ssoc_b"], atMs: T0 + 1_000 });

      const targets = await repository.findDomainsProvedByRecord({ limit: 3 });

      expect(targets.map((target) => target.connectionId)).toEqual(["ssoc_c", "ssoc_a", "ssoc_b"]);
      expect(targets[0]?.method).toBe("https-file");
    });

    /** @scenario "A domain no published proof ever proved is never doubted by DNS" */
    it("leaves out a connection whose domain nothing published proved", async () => {
      seed("ssoc_attested", "attested.example");
      const attested = store.ssoConnections.get("ssoc_attested");
      store.ssoConnections.set("ssoc_attested", {
        ...emptySsoConnection({ connectionId: "ssoc_attested" }),
        ...attested,
        domainVerifications: [
          {
            domain: "attested.example",
            method: "operator-attested",
            actorId: "user_operator",
            verifiedAtMs: T0,
            proofState: "VERIFIED",
            firstAbsentAtMs: null,
            graceEndsAtMs: null,
            tokenHash: null,
          },
        ],
      });

      expect(await repository.findDomainsProvedByRecord({ limit: 3 })).toEqual([]);
    });

    /** @scenario "Every proved domain is re-read in turn rather than the same few for ever" */
    it("never moves a look backwards, so a late sweep cannot re-queue a connection", async () => {
      seed("ssoc_a", "a.example");
      seed("ssoc_b", "b.example");
      await repository.markSwept({ connectionIds: ["ssoc_a"], atMs: T0 + 5_000 });
      await repository.markSwept({ connectionIds: ["ssoc_b"], atMs: T0 });
      await repository.markSwept({ connectionIds: ["ssoc_a"], atMs: T0 });

      const targets = await repository.findDomainsProvedByRecord({ limit: 2 });

      expect(targets.map((target) => target.connectionId)).toEqual(["ssoc_b", "ssoc_a"]);
    });
  });
});
