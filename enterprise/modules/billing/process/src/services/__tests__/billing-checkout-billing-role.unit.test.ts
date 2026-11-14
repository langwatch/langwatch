/**
 * Whoever started a checkout keeps paying: completion hands them the Billing role.
 * Spec: specs/licensing/billing-role.feature
 */
import {
  BindingMissingError,
  type AuthzApi,
  type AuthzSetBillingRoleInput,
} from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { BillingStarterRoleService } from "../billing-starter-role.service.ts";

const ORG = "org-1";
const ADMIN = "user-admin";
const STARTER = "user-starter";

function starterRole({ failure }: { failure?: Error } = {}) {
  const writes: AuthzSetBillingRoleInput[] = [];
  const billingRoles = createApiFixture<AuthzApi>({
    findActiveOrganizationAdministrators: async () => [ADMIN],
    setBillingRole: async (input) => {
      if (failure) throw failure;
      writes.push(input);
    },
  });
  return { service: BillingStarterRoleService.create({ billingRoles }), writes };
}

describe("BillingStarterRoleService", () => {
  /** @scenario "Checkout completer becomes Billing" */
  it("gives a member who is not an administrator the Billing role, keyed by the event", async () => {
    const { service, writes } = starterRole();

    await service.grantToStarter({
      organizationId: ORG,
      startedByUserId: STARTER,
      eventId: "evt_1",
    });

    expect(writes).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        userId: STARTER,
        holds: true,
        source: "checkout",
        commandId: "billing-checkout:evt_1",
      }),
    ]);
  });

  /** @scenario "An administrator who completes checkout is not given Billing" */
  it("writes nothing when an administrator started it", async () => {
    const { service, writes } = starterRole();

    await service.grantToStarter({ organizationId: ORG, startedByUserId: ADMIN, eventId: "evt_2" });

    expect(writes).toEqual([]);
  });

  it("writes nothing when the checkout names no starter", async () => {
    const { service, writes } = starterRole();

    await service.grantToStarter({ organizationId: ORG, startedByUserId: null, eventId: "evt_3" });

    expect(writes).toEqual([]);
  });

  /** @scenario "A checkout starter who left the organization is not given Billing" */
  it("completes without the role when the starter no longer has a membership", async () => {
    const { service } = starterRole({ failure: new BindingMissingError() });

    await expect(
      service.grantToStarter({ organizationId: ORG, startedByUserId: STARTER, eventId: "evt_4" }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "A checkout starter who left the organization is not given Billing" */
  it("still fails on any other error, so the webhook retries", async () => {
    const { service } = starterRole({ failure: new Error("ledger unavailable") });

    await expect(
      service.grantToStarter({ organizationId: ORG, startedByUserId: STARTER, eventId: "evt_5" }),
    ).rejects.toThrow("ledger unavailable");
  });

  /** @scenario "Checkout completer becomes Billing" */
  it("writes as the system, a consequence of the checkout already paid for", async () => {
    const { service, writes } = starterRole();

    await service.grantToStarter({
      organizationId: ORG,
      startedByUserId: STARTER,
      eventId: "evt_6",
    });

    expect(writes[0]?.caller).toEqual({ type: "system" });
  });
});
