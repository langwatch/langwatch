// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see modules/notification/specs/customer-io-transactional.feature
 */
import {
  nurturingSecrets,
  type NurturingServerConfig,
  type TransactionalEmail,
} from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets, SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type { CustomerIoTransactionalChannel } from "../../channels/customer-io-transactional.channel.ts";
import { HttpNurturingChannels } from "../../channels/http/http.nurturing.channels.ts";
import { MemoryCustomerIoTransactionalChannel } from "../../channels/memory/memory.customer-io-transactional.channel.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { NurturingModule } from "../nurturing.app.ts";

const config: NurturingServerConfig = {
  customerIoRegion: void 0,
  customerIoBaseUrl: void 0,
  posthogKey: void 0,
  posthogHost: void 0,
};

const email: TransactionalEmail = {
  transactionalMessageId: "usage-limit",
  identifiers: { email: "ada@acme.test" },
  to: "ada@acme.test",
  from: "LangWatch <contact@langwatch.test>",
  subject: "You reached your plan's usage limit",
  body: "<p>Upgrade to keep tracing</p>",
};

/** The real module, built with a transactional Customer.io channel or without one. */
function moduleWith(
  customerIoTransactional: CustomerIoTransactionalChannel | undefined,
  users: Partial<UserApi> = { findByEmail: async () => null },
): Promise<NurturingModule> {
  return NurturingModule.create({
    dependencies: {
      users: createApiFixture<UserApi>(users, "UserApi"),
      organizations: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    },
    config,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories: MemoryNurturingRepositories.create(),
    channels: { customerIo: void 0, customerIoTransactional, posthog: void 0 },
  });
}

/** The live tier's channels over an environment that holds `environment`'s secrets only. */
function liveChannels(environment: Record<string, string>) {
  const secrets = SecretsResolver.over(SecretsChain.start({ environment }).withEnv()).scopeTo(
    "nurturing",
    Object.values(nurturingSecrets),
  );
  return HttpNurturingChannels.create({ config, secrets });
}

describe("given nurturing holding the Customer.io App API key", () => {
  describe("when Customer.io takes the message", () => {
    /** @scenario "Nurturing answers whether Customer.io took the message" */
    it("answers queued with the delivery id, having handed over the message as given", async () => {
      const channel = MemoryCustomerIoTransactionalChannel.create();
      const app = await moduleWith(channel);

      await expect(app.sendTransactionalEmail(email)).resolves.toEqual({
        outcome: "queued",
        deliveryId: "delivery-1",
      });
      expect(channel.sent).toEqual([email]);
    });
  });

  describe("when Customer.io refuses it", () => {
    /** @scenario "Nurturing answers whether Customer.io took the message" */
    it("answers refused with the reason and status rather than throwing", async () => {
      const channel = MemoryCustomerIoTransactionalChannel.create().failWith({
        reason: "status",
        status: 429,
      });
      const app = await moduleWith(channel);

      await expect(app.sendTransactionalEmail(email)).resolves.toEqual({
        outcome: "refused",
        reason: "status",
        status: 429,
      });
    });
  });
});

describe("given the address belongs to a LangWatch user", () => {
  it("files the send under the user id and sends no address identifier", async () => {
    const channel = MemoryCustomerIoTransactionalChannel.create();
    const app = await moduleWith(channel, {
      findByEmail: async () => ({ id: "user-1" }) as UserProfile,
    });

    await app.sendTransactionalEmail(email);

    expect(channel.sent).toEqual([{ ...email, identifiers: { id: "user-1" } }]);
  });
});

describe("given the address belongs to no user", () => {
  it("files the send under the address", async () => {
    const channel = MemoryCustomerIoTransactionalChannel.create();
    const app = await moduleWith(channel);

    await app.sendTransactionalEmail(email);

    expect(channel.sent).toEqual([{ ...email, identifiers: { email: "ada@acme.test" } }]);
  });
});

describe("given the user lookup throws", () => {
  it("still sends, by address", async () => {
    const channel = MemoryCustomerIoTransactionalChannel.create();
    const app = await moduleWith(channel, {
      findByEmail: async () => {
        throw new Error("database down");
      },
    });

    await expect(app.sendTransactionalEmail(email)).resolves.toMatchObject({ outcome: "queued" });
    expect(channel.sent).toEqual([{ ...email, identifiers: { email: "ada@acme.test" } }]);
  });
});

describe("given nurturing without the Customer.io App API key", () => {
  describe("when it is handed a message", () => {
    /** @scenario "Nurturing answers whether Customer.io took the message" */
    it("answers off", async () => {
      const app = await moduleWith(void 0);

      await expect(app.sendTransactionalEmail(email)).resolves.toEqual({ outcome: "off" });
    });
  });
});

describe("given the live channel tier", () => {
  describe("when CUSTOMER_IO_APP_API_KEY is set, or not", () => {
    /** @scenario "Without IS_SAAS or the key nothing reaches Customer.io" */
    it("builds the transactional client only with the key", async () => {
      const keyed = await liveChannels({ CUSTOMER_IO_APP_API_KEY: "cio_app_key" });
      const unkeyed = await liveChannels({});

      expect(keyed.customerIoTransactional).toBeDefined();
      expect(unkeyed.customerIoTransactional).toBeUndefined();
    });
  });
});
