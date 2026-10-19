import type { AccountIdentifier, RoutingDecision } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { SignInGovernanceService } from "../sign-in-governance.service.ts";

const address = (value: string, confirmed = true): AccountIdentifier => ({
  identifierId: `ident_${value}`,
  accountId: null,
  provider: "email",
  value,
  isPrimary: true,
  confirmed,
  resendable: false,
  removable: false,
  refusalCode: null,
  demotesFirst: false,
});

const redirect = (connectionId?: string): RoutingDecision => ({
  outcome: "redirect_to_connection",
  ...(connectionId === undefined ? {} : { connectionId }),
  methodSet: [],
  reasonCode: "domain_routed",
});

function governance({
  identifiers,
  route,
  accountEmail,
}: {
  identifiers: AccountIdentifier[];
  route: (identifier: string | null) => RoutingDecision;
  accountEmail?: string;
}) {
  const router = {
    route: vi.fn(async ({ identifier }: { identifier: string | null }) => route(identifier)),
  };
  return {
    router,
    service: SignInGovernanceService.create({
      identifiers: { listIdentifiers: async () => identifiers },
      accountAddress: async () => (accountEmail ? { email: accountEmail } : null),
      router,
    }),
  };
}

describe("whether single sign-on governs somebody's own sign-in", () => {
  /** @scenario "A person whose organization's single sign-on governs sign-in is not offered a passkey" */
  it("is governed when a confirmed address routes to an organization connection", async () => {
    const { service } = governance({
      identifiers: [address("ivy@acme.com")],
      route: () => redirect("conn_okta"),
    });

    await expect(service.isGovernedBySso({ userId: "user_ivy" })).resolves.toBe(true);
  });

  /** @scenario "A person whose organization's single sign-on governs sign-in is not offered a passkey" */
  it("is not governed by instance federation, which names no connection", async () => {
    const { service } = governance({
      identifiers: [address("ivy@acme.com")],
      route: () => redirect(),
    });

    await expect(service.isGovernedBySso({ userId: "user_ivy" })).resolves.toBe(false);
  });

  /** @scenario "A person whose organization's single sign-on governs sign-in is not offered a passkey" */
  it("never routes an unconfirmed address", async () => {
    const { service, router } = governance({
      identifiers: [address("ivy@acme.com", false)],
      route: () => redirect("conn_okta"),
    });

    await expect(service.isGovernedBySso({ userId: "user_ivy" })).resolves.toBe(false);
    expect(router.route).not.toHaveBeenCalled();
  });

  /** @scenario "An account its single sign-on created is governed through its own address" */
  it("is governed when the account's own address routes there, with no identifier attached", async () => {
    const { service, router } = governance({
      identifiers: [],
      accountEmail: "ivy@acme.com",
      route: (identifier) => (identifier === "ivy@acme.com" ? redirect("conn_okta") : redirect()),
    });

    await expect(service.isGovernedBySso({ userId: "user_ivy" })).resolves.toBe(true);
    expect(router.route).toHaveBeenCalledWith({ identifier: "ivy@acme.com", breakGlass: false });
  });
});
