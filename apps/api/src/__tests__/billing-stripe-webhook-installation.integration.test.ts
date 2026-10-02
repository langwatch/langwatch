/**
 * Billing's doors as main served them — the Stripe callback at `POST /api/webhooks/stripe`,
 * and the `subscription` and `currency` tRPC routers — over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { RestHost } from "@langwatch/api/rest";
import { ModuleApiToken } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";
import { bootApi } from "./api-installation.fixture.ts";

const closed = {
  authenticate: () => {
    throw new Error("the provider callback resolves no credential.");
  },
};

describe("the api process installation", () => {
  /** @scenario "A deployment with no Stripe composed answers the callback with 404" */
  it("answers the Stripe callback from the installed billing module", async () => {
    const { runtime } = await bootApi();

    try {
      const host = RestHost.create({
        identities: {
          project: closed,
          organization: closed,
          api_key: closed,
          scim_token: closed,
          instance_admin: closed,
          browser: closed,
        },
        bearers: () => closed,
        audit: { record: async () => {} },
      });
      const isCallback = (transport: { protocol: string; namespace?: string }) =>
        transport.protocol === "rest" && transport.namespace === "billing-stripe-webhook";
      const owner = processModules.find((module) => (module.transports ?? []).some(isCallback));
      const callback = owner?.transports?.find(isCallback);
      const contract = owner?.apiContract;
      if (!owner || !callback || !(contract instanceof ModuleApiToken)) {
        throw new Error("no installed module declares the Stripe callback");
      }
      expect(owner.name).toBe("billing");
      host.mount(callback.router(), () => runtime.service(contract));

      const delivered = await host.app.fetch(
        new Request("http://api.test/api/webhooks/stripe", {
          method: "POST",
          headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
          body: '{"id":"evt_1"}',
        }),
      );

      expect(delivered.status).toBe(404);
    } finally {
      await runtime.stop();
    }
  });

  it("serves main's subscription and currency procedures from the installed billing module", () => {
    const billing = processModules.find((module) => module.name === "billing");
    const procedures = (billing?.transports ?? []).flatMap((transport) => {
      if (transport.protocol !== "trpc" || !("contract" in transport)) return [];
      const { contract } = transport;
      if (typeof contract !== "object" || contract === null || !("members" in contract)) return [];
      const { members } = contract;
      if (typeof members !== "object" || members === null) return [];
      return Object.keys(members).map((name) => `${transport.namespace}.${name}`);
    });

    expect(procedures).toEqual(
      expect.arrayContaining([
        "subscription.create",
        "subscription.manage",
        "subscription.addTeamMemberOrEvents",
        "subscription.upgradeWithInvites",
        "subscription.previewProration",
        "subscription.getLastSubscription",
        "subscription.listInvoices",
        "currency.detectCurrency",
      ]),
    );
  });
});
