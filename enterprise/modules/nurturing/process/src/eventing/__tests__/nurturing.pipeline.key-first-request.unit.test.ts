// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Gateway's fact that a key served its first request, through nurturing's own lanes and copies,
 * to the requests a recording Customer.io received.
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordVkFirstRequestCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { KEY_FIRST_REQUEST_COPY_ATTEMPTS } from "../../services/nurturing-gateway-facts.service.ts";
import {
  ADMIN_USER_ID,
  firstRequestFact,
  gatewayEvent,
  gatewayFactsOver,
  lifecycleFact,
} from "./nurturing-gateway-facts.test-helpers.ts";

const created = (overrides: Partial<RecordVkLifecycleCommandData> = {}) =>
  gatewayEvent({ type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data: lifecycleFact(overrides) });

const firstRequest = (overrides: Partial<RecordVkFirstRequestCommandData> = {}) =>
  gatewayEvent({ type: GATEWAY_VK_FIRST_REQUEST_EVENT_TYPE, data: firstRequestFact(overrides) });

/** The has_app_request identifies sent, as [recipient, traits]. */
const appRequestIdentifies = (sent: readonly CioBatchCall[]) =>
  sent.flatMap((call) =>
    call.type === "identify" && call.traits && "has_app_request" in call.traits
      ? [[call.userId, call.traits]]
      : [],
  );

describe("a gateway key's first request in nurturing", () => {
  describe("when a current member's USER key serves its first request", () => {
    let facts: Awaited<ReturnType<typeof gatewayFactsOver>>;

    beforeEach(async () => {
      facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
    });

    /** @scenario "A key's first request sets has_app_request on the person told of the key" */
    it("identifies the holder with has_app_request true and tracks nothing", async () => {
      const beforeFirstRequest = facts.sent.length;

      await facts.deliverFact(firstRequest());

      expect(facts.sent.slice(beforeFirstRequest)).toEqual([
        {
          type: "identify",
          userId: "user-holder",
          traits: { has_app_request: true, email: "user-holder@example.com" },
        },
      ]);
    });

    it("sends virtual_key_created before has_app_request, and never has_app_request false", async () => {
      await facts.deliverFact(firstRequest());

      const order = facts.sent.map((call) =>
        call.type === "track"
          ? call.event
          : Object.keys(call.traits ?? {})
              .filter((key) => key !== "email")
              .join(","),
      );
      expect(order).toEqual(["has_virtual_key", "virtual_key_created", "has_app_request"]);
      expect(JSON.stringify(facts.sent)).not.toMatch(/"has_app_request":(false|null)/);
    });
  });

  describe("when the key's holder is a disabled member and its creator a current one", () => {
    /** @scenario "A key's first request is told to whoever its creation was told to" */
    it("identifies the creator, as virtual_key_created went to them", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.disabled("user-holder");
      await facts.joined("user-creator");

      await facts.deliverFact(created());
      await facts.deliverFact(firstRequest());

      expect(new Set(facts.sent.map(({ userId }) => userId))).toEqual(new Set(["user-creator"]));
      expect(appRequestIdentifies(facts.sent)).toEqual([
        ["user-creator", { has_app_request: true, email: "user-creator@example.com" }],
      ]);
    });
  });

  describe("when neither the key's holder nor its creator is a member", () => {
    /** @scenario "A key's first request is told to whoever its creation was told to" */
    it("identifies the organization's admin, as virtual_key_created went to them", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(created());
      await facts.deliverFact(firstRequest());

      expect(facts.sent.map(({ userId }) => userId)).toEqual([ADMIN_USER_ID, ADMIN_USER_ID]);
      expect(appRequestIdentifies(facts.sent)).toEqual([
        [ADMIN_USER_ID, { has_app_request: true, email: `${ADMIN_USER_ID}@example.com` }],
      ]);
    });
  });

  describe("when no one matches and the copied admin is no current member", () => {
    /** @scenario "A key's first request is told to whoever its creation was told to" */
    it("identifies no one and logs the dropped fact at debug level", async () => {
      const facts = await gatewayFactsOver();
      await facts.disabled(ADMIN_USER_ID);
      await facts.deliverFact(created());

      await facts.deliverFact(firstRequest());

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("debug", "no current member to tell")).toBeDefined();
    });
  });

  describe("when the key is a Connect or Langy key, revoked or disabled", () => {
    /** @scenario "A first request on a key nurturing does not tell of sends nothing" */
    it("sends nothing", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(
        created({
          virtual_key_id: "vk_connect",
          purpose: "CONNECT",
          actor_user_id: null,
          principal_user_id: null,
        }),
      );
      await facts.deliverFact(created({ virtual_key_id: "vk_langy", purpose: "LANGY" }));
      await facts.deliverFact(created({ virtual_key_id: "vk_revoked" }));
      await facts.deliverFact(
        created({ virtual_key_id: "vk_revoked", action: "revoked", occurred_at: 2_000 }),
      );
      await facts.deliverFact(created({ virtual_key_id: "vk_disabled" }));
      await facts.deliverFact(
        created({ virtual_key_id: "vk_disabled", action: "disabled", occurred_at: 2_000 }),
      );
      const beforeFirstRequests = facts.sent.length;

      for (const virtualKeyId of ["vk_connect", "vk_langy", "vk_revoked", "vk_disabled"]) {
        await facts.deliverFact(firstRequest({ virtual_key_id: virtualKeyId }));
      }

      expect(facts.sent).toHaveLength(beforeFirstRequests);
      expect(appRequestIdentifies(facts.sent)).toEqual([]);
    });
  });

  describe("when the first request arrives before nurturing copies the key", () => {
    /** @scenario "A first request before the key's copy is retried until the copy lands" */
    it("fails the delivery, and its retry after the copy identifies the holder once", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");

      await expect(facts.deliverFact(firstRequest(), { deliveryAttempt: 1 })).rejects.toThrow(
        "has no copy in nurturing yet",
      );
      expect(facts.sent).toEqual([]);
      await facts.deliverFact(created());
      await facts.deliverFact(firstRequest(), { deliveryAttempt: 2 });

      expect(appRequestIdentifies(facts.sent)).toEqual([
        ["user-holder", { has_app_request: true, email: "user-holder@example.com" }],
      ]);
    });
  });

  describe("when a first request arrives with no delivery attempt", () => {
    /** @scenario "A first request with no delivery attempt counts as the first and is retried" */
    it("fails the delivery as its first attempt, so its job is retried", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");

      await expect(
        facts.deliverFact(firstRequest({ virtual_key_id: "vk_no_attempt" })),
      ).rejects.toThrow("has no copy in nurturing yet");
      expect(facts.sent).toEqual([]);
    });
  });

  describe("when nurturing never copies the key", () => {
    /** @scenario "A first request on a key nurturing never copies ends unsent after its retries" */
    it("fails each delivery before the last attempt, then ends unsent with an error", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      const uncopied = firstRequest({ virtual_key_id: "vk_never_copied" });

      for (let attempt = 1; attempt < KEY_FIRST_REQUEST_COPY_ATTEMPTS; attempt++) {
        await expect(facts.deliverFact(uncopied, { deliveryAttempt: attempt })).rejects.toThrow(
          "has no copy in nurturing yet",
        );
      }
      await facts.deliverFact(uncopied, { deliveryAttempt: KEY_FIRST_REQUEST_COPY_ATTEMPTS });

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("error", "holds no copy of after its retries")).toBeDefined();
      expect(facts.logLines.findLine("warn", "holds no copy of after its retries")).toBeUndefined();
    });
  });

  describe("when the same first-request fact is delivered twice", () => {
    /** @scenario "A key's first request delivered twice identifies once" */
    it("identifies the holder once", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(firstRequest());

      expect(appRequestIdentifies(facts.sent)).toEqual([
        ["user-holder", { has_app_request: true, email: "user-holder@example.com" }],
      ]);
    });
  });

  describe("when Customer.io refuses the has_app_request identify once", () => {
    /** @scenario "A refused has_app_request identify is retried" */
    it("fails the delivery, and its retry sends the identify once", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      facts.refusing.add("identify");

      await expect(facts.deliverFact(firstRequest())).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );
      facts.refusing.clear();
      await facts.deliverFact(firstRequest());

      expect(appRequestIdentifies(facts.sent)).toEqual([
        ["user-holder", { has_app_request: true, email: "user-holder@example.com" }],
      ]);
    });
  });
});
