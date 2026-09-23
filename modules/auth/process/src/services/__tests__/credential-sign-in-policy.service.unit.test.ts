/**
 * specs/identity/sso-credential-enforcement.feature - whether an already
 * proved password may open the local door for the address it was proved with.
 */
import type { RoutingDecision } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { CredentialSignInPolicyService } from "../credential-sign-in-policy.service.ts";

const CONNECTION = "conn-1";
const ORG = "org-1";

const governed: RoutingDecision = {
  outcome: "redirect_to_connection",
  reasonCode: "domain_routed",
  connectionId: CONNECTION,
  methodSet: [{ id: CONNECTION, kind: "federated", connectionId: CONNECTION }],
};

const ungoverned: RoutingDecision = {
  outcome: "method_picker",
  reasonCode: "no_domain_match",
  methodSet: [{ id: "password", kind: "password", connectionId: null }],
};

/** Instance federation: the deployment's own provider, carrying no connection. */
const instanceFederated: RoutingDecision = {
  outcome: "redirect_to_connection",
  reasonCode: "no_domain_match",
  methodSet: [{ id: "auth0", kind: "federated", connectionId: null }],
};

function policyFor({
  decision = governed,
  grants = [] as readonly { userId: string; live: boolean }[],
  routingComposed = true,
}: {
  decision?: RoutingDecision;
  grants?: readonly { userId: string; live: boolean }[];
  routingComposed?: boolean;
} = {}) {
  const findGrants = vi.fn().mockResolvedValue(grants);
  const getOrganization = vi.fn().mockResolvedValue({ organizationId: ORG });
  const route = vi.fn().mockResolvedValue(decision);
  const policy = CredentialSignInPolicyService.create({
    routing: routingComposed ? { route } : null,
    connections: { getOrganization },
    recovery: { findGrants },
  });
  return { policy, findGrants, getOrganization, route };
}

describe("given an address an organization's connection governs", () => {
  /** @scenario "Recovery permission belongs to the authenticated user and governing organization" */
  it("refuses a signer holding no grant, and one holding another user's", async () => {
    await expect(
      policyFor().policy.canSignIn({ userId: "alice", email: "alice@acme.test" }),
    ).resolves.toBe(false);
    await expect(
      policyFor({ grants: [{ userId: "bob", live: true }] }).policy.canSignIn({
        userId: "alice",
        email: "alice@acme.test",
      }),
    ).resolves.toBe(false);
  });

  /** @scenario "Recovery permission belongs to the authenticated user and governing organization" */
  it("allows the holder of a live grant for the governing organization", async () => {
    const { policy, getOrganization } = policyFor({
      grants: [{ userId: "alice", live: true }],
    });

    await expect(policy.canSignIn({ userId: "alice", email: "alice@acme.test" })).resolves.toBe(
      true,
    );
    expect(getOrganization).toHaveBeenCalledWith({ connectionId: CONNECTION });
  });

  /** @scenario "Recovery login ends at grant expiry or revocation without waiting for a worker" */
  it("refuses the same holder once the grant stops being live", async () => {
    const { policy } = policyFor({ grants: [{ userId: "alice", live: false }] });

    await expect(policy.canSignIn({ userId: "alice", email: "alice@acme.test" })).resolves.toBe(
      false,
    );
  });

  /** @scenario "Recovery checks retain the proved alias rather than the canonical email" */
  it("routes on the address it was given, not on any other", async () => {
    const { policy, route } = policyFor({ grants: [{ userId: "alice", live: true }] });

    await policy.canSignIn({ userId: "alice", email: "alice@acme.test" });

    expect(route).toHaveBeenCalledWith({ identifier: "alice@acme.test", breakGlass: false });
  });
});

describe("given an address no organization connection governs", () => {
  /** @scenario "An ungoverned personal address keeps its existing local sign-in route" */
  it("allows the sign-in without reading a grant", async () => {
    const { policy, findGrants } = policyFor({ decision: ungoverned });

    await expect(policy.canSignIn({ userId: "alice", email: "alice@personal.test" })).resolves.toBe(
      true,
    );
    expect(findGrants).not.toHaveBeenCalled();
  });

  /** @scenario "Instance federation leaves credential permission to the deployment policy" */
  it("requires no recovery grant when routing picked a provider with no connection", async () => {
    const { policy, findGrants } = policyFor({ decision: instanceFederated });

    await expect(policy.canSignIn({ userId: "alice", email: "alice@acme.test" })).resolves.toBe(
      true,
    );
    expect(findGrants).not.toHaveBeenCalled();
  });
});

describe("given a process that composed no sign-in routing directory", () => {
  /** @scenario "Instance federation leaves credential permission to the deployment policy" */
  it("leaves the decision to the deployment's own gate", async () => {
    const { policy, route } = policyFor({ routingComposed: false });

    await expect(policy.canSignIn({ userId: "alice", email: "alice@acme.test" })).resolves.toBe(
      true,
    );
    expect(route).not.toHaveBeenCalled();
  });
});
