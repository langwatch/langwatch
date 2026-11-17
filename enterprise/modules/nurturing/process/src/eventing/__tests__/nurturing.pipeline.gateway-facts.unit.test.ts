// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Gateway's key facts through nurturing's own lanes and copies, as the worker hands them over, to
 * the requests a recording Customer.io received.
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  GATEWAY_BUDGET_CROSSING_EVENT_TYPE,
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  type RecordBudgetCrossingCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  ADMIN_USER_ID,
  crossingFact,
  gatewayEvent,
  gatewayFactsOver,
  lifecycleFact,
  ORGANIZATION_ID,
  userErasedEvent,
} from "./nurturing-gateway-facts.test-helpers.ts";

const created = (overrides: Partial<RecordVkLifecycleCommandData> = {}) =>
  gatewayEvent({ type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data: lifecycleFact(overrides) });

const crossed = (overrides: Partial<RecordBudgetCrossingCommandData> = {}) =>
  gatewayEvent({ type: GATEWAY_BUDGET_CROSSING_EVENT_TYPE, data: crossingFact(overrides) });

/** A later lifecycle action on vk_1, at `at`. */
const changed = (
  action: RecordVkLifecycleCommandData["action"],
  at: number,
  overrides: Partial<RecordVkLifecycleCommandData> = {},
) => created({ action, occurred_at: at, ...overrides });

/** Each call as its type, recipient and event, the shape every recipient assertion reads. */
const callsOf = (sent: readonly CioBatchCall[]) =>
  sent.map((call) => [call.type, call.userId, call.type === "track" ? call.event : null]);

/** The properties of every key_budget_threshold track, in the order sent. */
function thresholdProperties(sent: readonly CioBatchCall[]) {
  return sent.flatMap((call) =>
    call.type === "track" && call.event === "key_budget_threshold" ? [call.properties] : [],
  );
}

/** Everything Customer.io was told of a key: a call's traits or properties, no recipient. */
const attributesOf = (sent: readonly CioBatchCall[]) =>
  JSON.stringify(sent.map((call) => ("traits" in call ? call.traits : call.properties)));

const KEY_PROPERTIES = {
  key_name: "Jane's key",
  virtual_key_id: "vk_1",
  organization_id: ORGANIZATION_ID,
};

describe("gateway's key facts in nurturing", () => {
  describe("when gateway records a USER key created for a current member", () => {
    /** @scenario "A created person's key sets has_virtual_key and sends virtual_key_created" */
    it("identifies the holder with has_virtual_key and tracks virtual_key_created to them", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");

      await facts.deliverFact(created());

      expect(facts.sent).toEqual([
        { type: "identify", userId: "user-holder", traits: { has_virtual_key: true } },
        {
          type: "track",
          userId: "user-holder",
          event: "virtual_key_created",
          properties: KEY_PROPERTIES,
        },
      ]);
    });
  });

  describe("when the key is then revoked, the person's last", () => {
    /** @scenario "has_virtual_key stays true after the person's last key is revoked" */
    it("sends nothing, so has_virtual_key is never set false", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());

      await facts.deliverFact(changed("revoked", 2_000));

      expect(callsOf(facts.sent)).toEqual([
        ["identify", "user-holder", null],
        ["track", "user-holder", "virtual_key_created"],
      ]);
      expect(attributesOf(facts.sent)).not.toContain('"has_virtual_key":false');
    });
  });

  describe("when the key is rotated under a new name, disabled, enabled and revoked", () => {
    /** @scenario "Rotating, disabling, enabling or revoking a key sends nothing and updates the key copy" */
    it("sends nothing and folds each into the key copy, its creator unchanged", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      const afterCreated = facts.sent.length;

      const renamed = { name: "Renamed", actor_user_id: "user-other" };
      await facts.deliverFact(changed("rotated", 2_000, renamed));
      await facts.deliverFact(changed("disabled", 3_000, { ...renamed, reason: "billing hold" }));
      await facts.deliverFact(changed("enabled", 4_000, renamed));
      await facts.deliverFact(changed("revoked", 5_000, renamed));

      expect(facts.sent).toHaveLength(afterCreated);
      await expect(
        facts.virtualKeys.findKey({ organizationId: ORGANIZATION_ID, virtualKeyId: "vk_1" }),
      ).resolves.toMatchObject([
        {
          name: "Renamed",
          creatorUserId: "user-creator",
          principalUserId: "user-holder",
          disabledAt: 3_000,
          enabledAt: 4_000,
          revokedAt: 5_000,
        },
      ]);
    });
  });

  describe("when a copied key's budget crosses its warn line, then breaches", () => {
    /** @scenario "A threshold crossing sends key_budget_threshold with every attribute" */
    it("tracks key_budget_threshold to the holder with every attribute, reached only on the breach", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());

      await facts.deliverFact(crossed());
      await facts.deliverFact(crossed({ kind: "breached", spent_usd: "120.000000" }));

      expect(thresholdProperties(facts.sent)).toEqual([
        {
          ...KEY_PROPERTIES,
          key_budget: 100,
          key_spend: 84.5,
          budget_reached: false,
          on_breach: "warn",
          window: "month",
          scope_type: "virtual_key",
          budget_period_end: "1970-01-01T00:33:20.000Z",
        },
        expect.objectContaining({ key_spend: 120, budget_reached: true }),
      ]);
      expect(callsOf(facts.sent).slice(-2)).toEqual([
        ["track", "user-holder", "key_budget_threshold"],
        ["track", "user-holder", "key_budget_threshold"],
      ]);
    });
  });

  describe("when a budget anchored on the 31st crosses in the period from 28 February", () => {
    /** @scenario "A monthly budget anchored on the 31st sends gateway's period end" */
    it("sends gateway's 31 March end as ISO-8601 UTC, and null for a TOTAL budget", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());

      await facts.deliverFact(
        crossed({
          period_started_at_ms: Temporal.Instant.from("2027-02-28T00:00:00Z").epochMilliseconds,
          period_ends_at_ms: Temporal.Instant.from("2027-03-31T00:00:00Z").epochMilliseconds,
        }),
      );
      await facts.deliverFact(
        crossed({ budget_id: "budget-hidden-2", window: "TOTAL", period_ends_at_ms: null }),
      );

      const ends = thresholdProperties(facts.sent).map((sent) => sent?.budget_period_end);
      expect(ends).toEqual(["2027-03-31T00:00:00.000Z", null]);
    });
  });

  describe("when a rolling budget's crossing was stored before gateway recorded its end", () => {
    it("leaves budget_period_end out rather than sending null, and warns", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      const stored: Partial<RecordBudgetCrossingCommandData> = { period_ends_at_ms: undefined };

      await facts.deliverFact(crossed(stored));

      const sent = thresholdProperties(facts.sent);
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toHaveProperty("budget_period_end");
      expect(facts.logLines.findLine("warn", "names no period end")).toBeDefined();
    });
  });

  describe("when a copied key is revoked, or disabled and not enabled again", () => {
    /** @scenario "A crossing for a revoked or disabled key sends nothing" */
    it("sends no crossing for either", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      await facts.deliverFact(created({ virtual_key_id: "vk_2", occurred_at: 1_100 }));
      await facts.deliverFact(changed("revoked", 2_000));
      await facts.deliverFact(changed("disabled", 2_000, { virtual_key_id: "vk_2" }));
      const beforeCrossings = facts.sent.length;

      await facts.deliverFact(crossed());
      await facts.deliverFact(crossed({ budget_id: "budget-2", virtual_key_id: "vk_2" }));

      expect(facts.sent).toHaveLength(beforeCrossings);
    });
  });

  describe("when an organization, project or team budget crosses", () => {
    /** @scenario "A crossing of an organization, project or team budget sends nothing" */
    it("sends nothing, the crossing naming no key", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      const beforeCrossings = facts.sent.length;

      for (const scope of ["organization", "project", "team"]) {
        await facts.deliverFact(
          crossed({ budget_id: `budget-${scope}`, scope_type: scope, virtual_key_id: null }),
        );
      }

      expect(facts.sent).toHaveLength(beforeCrossings);
    });
  });

  describe("when one end user's bucket of a budget attributed to the key crosses", () => {
    /** @scenario "A crossing of a budget attributed per end user sends nothing" */
    it("sends nothing, the spend being one end user's and not the key's", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      const beforeCrossings = facts.sent.length;

      for (const endUser of ["end-user-1", "end-user-2"]) {
        await facts.deliverFact(
          crossed({
            budget_id: "budget-attributed",
            scope_type: "attributed_user",
            bucket_scope_id: `vk_1:${endUser}`,
            end_user_id: endUser,
          }),
        );
      }

      expect(facts.sent).toHaveLength(beforeCrossings);
    });
  });

  describe("when a crossing names a key nurturing holds no copy of", () => {
    /** @scenario "A crossing for a key nurturing never copied sends nothing and warns" */
    it("sends nothing and logs a warning", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(crossed({ virtual_key_id: "vk_uncopied" }));

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("warn", "holds no copy of")).toBeDefined();
    });
  });

  describe("when the key's holder is a disabled member and its creator a current one", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("sends the creation and the crossing to the creator", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.disabled("user-holder");
      await facts.joined("user-creator");

      await facts.deliverFact(created());
      await facts.deliverFact(crossed());

      expect(new Set(facts.sent.map(({ userId }) => userId))).toEqual(new Set(["user-creator"]));
      expect(facts.sent).toHaveLength(3);
    });
  });

  describe("when neither the key's holder nor its creator is a member", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("sends the creation and the crossing to the organization's copied admin", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(created());
      await facts.deliverFact(crossed());

      expect(callsOf(facts.sent)).toEqual([
        ["track", ADMIN_USER_ID, "virtual_key_created"],
        ["track", ADMIN_USER_ID, "key_budget_threshold"],
      ]);
    });
  });

  describe("when no one matches and the organization has no copied admin", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("sends nothing and logs the dropped fact at debug level", async () => {
      const facts = await gatewayFactsOver();

      await facts.deliverFact(created({ organization_id: "org-without-admin" }));

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("debug", "no current member to tell")).toBeDefined();
    });
  });

  describe("when no one matches and the copied admin is no current member", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("sends nothing to the admin either, and logs the dropped fact at debug level", async () => {
      const facts = await gatewayFactsOver();
      await facts.disabled(ADMIN_USER_ID);

      await facts.deliverFact(created());

      expect(facts.sent).toEqual([]);
      expect(facts.logLines.findLine("debug", "no current member to tell")).toBeDefined();
    });
  });

  describe("when gateway creates a Connect licence's key or Langy's", () => {
    /** @scenario "CONNECT and LANGY keys send nothing" */
    it("sends nothing for either key's creation or its budget's crossing", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-creator");

      await facts.deliverFact(
        created({ purpose: "CONNECT", actor_user_id: null, principal_user_id: null }),
      );
      await facts.deliverFact(created({ virtual_key_id: "vk_langy", purpose: "LANGY" }));
      await facts.deliverFact(crossed());
      await facts.deliverFact(crossed({ budget_id: "budget-langy", virtual_key_id: "vk_langy" }));

      expect(facts.sent).toEqual([]);
    });
  });

  describe("when a fact stored before gateway recorded the purpose names a key", () => {
    it("treats the key as a USER key", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");

      await facts.deliverFact(created({ purpose: undefined }));

      expect(callsOf(facts.sent)).toContainEqual(["track", "user-holder", "virtual_key_created"]);
    });
  });

  describe("when Customer.io takes the identify and refuses the track", () => {
    /** @scenario "A refused Customer.io call is retried without repeating the call that went" */
    it("fails the delivery, and its retry sends the track and no second identify", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      facts.refusing.add("track");

      await expect(facts.deliverFact(created())).rejects.toThrow(
        "Customer.io /batch failed: HTTP 500",
      );
      facts.refusing.clear();
      await facts.deliverFact(created());

      expect(callsOf(facts.sent)).toEqual([
        ["identify", "user-holder", null],
        ["track", "user-holder", "virtual_key_created"],
      ]);
    });
  });

  describe("when the same creation and the same crossing are each delivered twice", () => {
    /** @scenario "The same fact delivered twice sends each call once" */
    it("sends one identify and one track for the creation, and one track for the crossing", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");

      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(created());
      for (let delivery = 0; delivery < 2; delivery++) await facts.deliverFact(crossed());

      expect(callsOf(facts.sent)).toEqual([
        ["identify", "user-holder", null],
        ["track", "user-holder", "virtual_key_created"],
        ["track", "user-holder", "key_budget_threshold"],
      ]);
    });
  });

  describe("when the key's holder and creator is erased, then its budget crosses", () => {
    /** @scenario "An erased person's key falls to the organization's admin" */
    it("clears them from the key copy and sends the crossing to the organization's admin", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-jane");
      await facts.deliverFact(
        created({ actor_user_id: "user-jane", principal_user_id: "user-jane" }),
      );

      await facts.deliverFact(userErasedEvent("user-jane"));
      await facts.deliverFact(crossed());

      await expect(
        facts.virtualKeys.findKey({ organizationId: ORGANIZATION_ID, virtualKeyId: "vk_1" }),
      ).resolves.toMatchObject([{ creatorUserId: null, principalUserId: null }]);
      expect(callsOf(facts.sent).at(-1)).toEqual(["track", ADMIN_USER_ID, "key_budget_threshold"]);
    });
  });

  describe("when every fact above has been delivered", () => {
    it("never sends the secret, prefix, reason, end user, bucket, budget, project or a person's id", async () => {
      const facts = await gatewayFactsOver();
      await facts.joined("user-holder");
      await facts.deliverFact(created());
      await facts.deliverFact(changed("disabled", 2_000, { reason: "billing hold" }));
      await facts.deliverFact(changed("enabled", 3_000));
      const hidden = {
        bucket_scope_id: "bucket-hidden-9",
        end_user_id: "end-user-9",
        anchor_project_id: "project-anchor-9",
      };
      await facts.deliverFact(crossed(hidden));
      await facts.deliverFact(crossed({ ...hidden, kind: "breached", spent_usd: "120.000000" }));

      const requests = facts.requests.join("\n");
      expect(facts.requests.length).toBeGreaterThan(0);
      for (const forbidden of [
        "vk-lw-",
        "display_prefix",
        "reason",
        "billing hold",
        "end_user_id",
        "end-user-9",
        "bucket_scope_id",
        "bucket-hidden-9",
        "budget_id",
        "budget-hidden-1",
        "anchor_project_id",
        "project-anchor-9",
        "user-creator",
      ]) {
        expect(requests, forbidden).not.toContain(forbidden);
      }
      expect(attributesOf(facts.sent)).not.toContain("user-holder");
    });
  });
});
