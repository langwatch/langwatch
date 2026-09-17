import {
  emptySsoConnection,
  type RoutableConnection,
} from "@langwatch/identity";
import { describe, expect, it, vi } from "vitest";
import { SsoBreakGlassService } from "../break-glass.service";
import { SignInRouterService } from "../signin-router.service";
import { SsoCredentialPolicy } from "../sso-credential-policy";
import {
  CollectingBreakGlassNotifier,
  InMemoryBreakGlassBindings,
} from "./support/in-memory-break-glass";
import { InMemoryConnections } from "./support/in-memory-connections";

function build() {
  let now = Date.now();
  let nextId = 0;
  const bindings = new InMemoryBreakGlassBindings();
  const holderIsEligible = vi.fn(async () => true);
  const breakGlass = new SsoBreakGlassService({
    bindings,
    holderIsEligible,
    notifier: new CollectingBreakGlassNotifier(),
    now: () => now,
    newBindingId: () => `binding_${++nextId}`,
  });
  const connection: RoutableConnection = {
    connectionId: "company_connection",
    state: "ACTIVE",
    configured: true,
    allowsJit: true,
    method: {
      id: "company_sso",
      kind: "federated",
      connectionId: "company_connection",
    },
  };
  const router = new SignInRouterService({
    domains: {
      legacy: {
        findConnectionForDomain: async ({ domain }) =>
          domain === "company.test" ? connection : null,
        listActiveConnections: async () => [connection],
      },
      connections: {
        findConnectionForDomain: async ({ domain }) =>
          domain === "company.test" ? connection : null,
        listActiveConnections: async () => [connection],
      },
    },
    policy: {
      resolvePolicy: async () => ({
        defaultMethods: [
          { id: "password", kind: "password", connectionId: null },
        ],
        localMethods: [
          { id: "password", kind: "password", connectionId: null },
        ],
        federationLicensed: true,
        selfHosted: true,
      }),
    },
    accounts: {
      findAccountMethods: async () => ({
        hasPassword: true,
        hasPasskey: false,
        providerIds: [],
        connectionIds: [],
      }),
    },
    breakGlass: { allow: async () => true },
    recorder: { decided: () => {} },
  });
  const connections = new InMemoryConnections();
  connections.seed({
    ...emptySsoConnection({ connectionId: connection.connectionId }),
    organizationId: "company",
    state: "ACTIVE",
  });
  const policy = SsoCredentialPolicy.create({
    router,
    connections,
    breakGlass,
  });
  const grant = ({ userId = "holder", organizationId = "company" } = {}) =>
    breakGlass.grant({
      userId,
      organizationId,
      grantedByUserId: "grantor",
      expiresAtMs: now + 60_000,
    });
  return {
    policy,
    grant,
    breakGlass,
    holderIsEligible,
    advance: () => {
      now += 60_000;
    },
  };
}

describe("SsoCredentialPolicy with the real router and recovery grants", () => {
  /** @scenario "Recovery permission belongs to the authenticated user and governing organization" */
  it("refuses absent, other-user and other-organization grants", async () => {
    const { policy, grant } = build();
    const attempt = { userId: "holder", email: "alias@company.test" };
    expect(await policy.canSignIn(attempt)).toBe(false);
    await grant({ userId: "another-user" });
    expect(await policy.canSignIn(attempt)).toBe(false);
    await grant({ organizationId: "another-organization" });
    expect(await policy.canSignIn(attempt)).toBe(false);
    await grant();
    expect(await policy.canSignIn(attempt)).toBe(true);
  });

  /** @scenario "An ungoverned personal address keeps its existing local sign-in route" */
  it("does not widen a company route to the user's personal address", async () => {
    const { policy } = build();
    expect(
      await policy.canSignIn({ userId: "holder", email: "alias@company.test" }),
    ).toBe(false);
    expect(
      await policy.canSignIn({
        userId: "holder",
        email: "canonical@personal.test",
      }),
    ).toBe(true);
  });

  /** @scenario "Recovery login ends at grant expiry or revocation without waiting for a worker" */
  it.each(["expiry", "revocation"])("refuses after %s", async (ending) => {
    const { policy, grant, breakGlass, advance } = build();
    const { bindingId } = await grant();
    const attempt = { userId: "holder", email: "alias@company.test" };
    expect(await policy.canSignIn(attempt)).toBe(true);
    if (ending === "expiry") advance();
    else await breakGlass.revoke({ bindingId, organizationId: "company" });
    expect(await policy.canSignIn(attempt)).toBe(false);
  });

  /** @scenario "A holder's role change does not revoke an existing recovery grant" */
  it("checks eligibility at grant time and preserves the grant after demotion", async () => {
    const { policy, grant, holderIsEligible } = build();
    await grant();
    expect(holderIsEligible).toHaveBeenCalledTimes(1);
    holderIsEligible.mockResolvedValue(false);
    expect(
      await policy.canSignIn({ userId: "holder", email: "alias@company.test" }),
    ).toBe(true);
    expect(holderIsEligible).toHaveBeenCalledTimes(1);
  });
});
