// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import type {
  RecordBudgetCrossingCommandData,
  RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  fireGatewayKeySignal,
  fireKeyBudgetThreshold,
  fireVirtualKeyCreated,
  isKeyOwnBudget,
  type KeyBudgetThresholdSignal,
  keyBudgetPeriodEndOf,
  keyFirstRequestSignal,
  type KeyRecipient,
  keyTopModelOf,
  pickKeyRecipient,
  virtualKeyCreatedSignal,
} from "../nurturing-gateway-facts.rules.ts";
import type { NurturingMembership } from "../nurturing-organization-member.rules.ts";
import type { NurturingOrganizationAdmin } from "../nurturing-subscription-sync-service.rules.ts";

const ADMIN: NurturingOrganizationAdmin = { kind: "admin", userId: "user-admin" };

const current = (userId: string, organizationId = "org-1"): NurturingMembership => ({
  organizationId,
  userId,
  joinedAt: 1_000,
  leftAt: null,
  returnedAt: null,
});

const disabled = (userId: string): NurturingMembership => ({
  ...current(userId),
  leftAt: 2_000,
});

describe("pickKeyRecipient", () => {
  const picked = (
    memberships: readonly NurturingMembership[],
    admin: NurturingOrganizationAdmin = ADMIN,
  ): KeyRecipient =>
    pickKeyRecipient({
      organizationId: "org-1",
      holders: ["user-holder", "user-creator"],
      memberships,
      admin,
    });
  const recipient = (
    memberships: readonly NurturingMembership[],
    admin: NurturingOrganizationAdmin = ADMIN,
  ): string | null => picked(memberships, admin).recipient;

  describe("given the holder and the creator are both current members", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("chooses the holder", () => {
      expect(recipient([current("user-holder"), current("user-creator")])).toBe("user-holder");
    });
  });

  describe("given the holder's membership is disabled", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("chooses the creator who is a current member", () => {
      expect(recipient([disabled("user-holder"), current("user-creator")])).toBe("user-creator");
    });
  });

  describe("given the holder is a current member of another organization only", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("does not count them, and chooses the creator", () => {
      const memberships = [current("user-holder", "org-2"), current("user-creator")];

      expect(recipient(memberships)).toBe("user-creator");
    });
  });

  describe("given neither is a current member", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("chooses the organization's admin, and no one without an admin", () => {
      const memberships = [
        disabled("user-holder"),
        disabled("user-creator"),
        current("user-admin"),
      ];

      expect(recipient(memberships)).toBe("user-admin");
      expect(recipient(memberships, { kind: "none" })).toBeNull();
    });
  });

  describe("given the copied admin is not a current member either", () => {
    /** @scenario "The key's holder hears it first, then its creator, then the organization's admin" */
    it("chooses no one", () => {
      expect(recipient([disabled("user-holder"), disabled("user-admin")])).toBeNull();
      expect(recipient([current("user-admin", "org-2")])).toBeNull();
    });
  });

  describe("given an id that is no person, as gateway's svc_ and system: principals are", () => {
    it("never chooses it, since only a copied member counts", () => {
      expect(
        pickKeyRecipient({
          organizationId: "org-1",
          holders: ["svc_project_1", "system:connect-license"],
          memberships: [current("user-admin")],
          admin: ADMIN,
        }).recipient,
      ).toBe("user-admin");
    });
  });

  describe("given the holder has no row of the organization and the admin is chosen", () => {
    it("lists the holder and the creator as passed over without a row", () => {
      expect(picked([current("user-admin")])).toEqual({
        recipient: "user-admin",
        passedOverWithoutRow: ["user-holder", "user-creator"],
      });
    });
  });

  describe("given the holder is chosen and the creator after them has no row", () => {
    it("lists no one, since no one without a row came before the holder", () => {
      expect(picked([current("user-holder")])).toEqual({
        recipient: "user-holder",
        passedOverWithoutRow: [],
      });
    });
  });

  describe("given the holder is disabled and the creator is chosen", () => {
    it("lists no one, since a disabled member has a row", () => {
      expect(picked([disabled("user-holder"), current("user-creator")])).toEqual({
        recipient: "user-creator",
        passedOverWithoutRow: [],
      });
    });
  });
});

describe("keyBudgetPeriodEndOf", () => {
  describe("given gateway's period end for a monthly budget anchored on the 31st", () => {
    /** @scenario "A monthly budget anchored on the 31st sends gateway's period end" */
    it("sends it as ISO-8601 UTC, doing no date math of its own", () => {
      const periodEndsAtMs = Temporal.Instant.from("2027-03-31T00:00:00Z").epochMilliseconds;

      expect(keyBudgetPeriodEndOf({ window: "MONTH", periodEndsAtMs })).toEqual({
        outcome: "known",
        periodEnd: "2027-03-31T00:00:00.000Z",
      });
    });
  });

  describe("given a TOTAL or MANUAL budget, whose window never rolls", () => {
    /** @scenario "A monthly budget anchored on the 31st sends gateway's period end" */
    it("sends a null period end", () => {
      for (const window of ["TOTAL", "MANUAL"]) {
        expect(keyBudgetPeriodEndOf({ window, periodEndsAtMs: null })).toEqual({
          outcome: "known",
          periodEnd: null,
        });
      }
    });
  });

  describe("given a rolling window whose fact was stored before gateway recorded its end", () => {
    it("is missing for every window from minute through month, so nothing misleading is sent", () => {
      for (const window of ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"]) {
        expect(keyBudgetPeriodEndOf({ window, periodEndsAtMs: null })).toEqual({
          outcome: "missing",
        });
      }
    });
  });
});

describe("fireVirtualKeyCreated", () => {
  const created: RecordVkLifecycleCommandData = {
    tenantId: "project-1",
    organization_id: "org-1",
    virtual_key_id: "vk_1",
    action: "created",
    name: "Jane's key",
    display_prefix: "vk-lw-abc",
    reason: null,
    actor_user_id: "user-creator",
    principal_user_id: "user-holder",
    purpose: "USER",
    occurred_at: 1_000,
  };
  const callsTo = (userId: string) =>
    fireVirtualKeyCreated(virtualKeyCreatedSignal({ data: created, userId }));

  describe("given the recipient holds the key or made it", () => {
    /** @scenario "A created person's key sets has_virtual_key and sends virtual_key_created" */
    it("sets has_virtual_key on them, then tracks virtual_key_created", () => {
      for (const userId of ["user-holder", "user-creator"]) {
        expect(callsTo(userId), userId).toEqual([
          { type: "identify", userId, traits: { has_virtual_key: true } },
          expect.objectContaining({ type: "track", userId, event: "virtual_key_created" }),
        ]);
      }
    });
  });

  describe("given the recipient is the organization's admin, told in place of both", () => {
    /** @scenario "An admin told of a key not theirs is not given has_virtual_key" */
    it("tracks virtual_key_created to the admin and sets no has_virtual_key", () => {
      const track = { type: "track", userId: "user-admin", event: "virtual_key_created" };

      expect(callsTo("user-admin")).toEqual([expect.objectContaining(track)]);
    });
  });
});

describe("isKeyOwnBudget", () => {
  const crossing = (
    overrides: Partial<RecordBudgetCrossingCommandData>,
  ): RecordBudgetCrossingCommandData => ({
    tenantId: "project-1",
    organization_id: "org-1",
    budget_id: "budget-1",
    kind: "threshold_crossed",
    scope_type: "virtual_key",
    bucket_scope_id: "vk_1",
    end_user_id: null,
    virtual_key_id: "vk_1",
    anchor_project_id: null,
    window: "MONTH",
    period_started_at_ms: 1_000_000,
    period_ends_at_ms: 2_000_000,
    limit_usd: "100.000000",
    spent_usd: "84.500000",
    on_breach: "warn",
    occurred_at: 5_000,
    ...overrides,
  });

  describe("given a crossing of the key's own budget", () => {
    /** @scenario "A threshold crossing sends key_budget_threshold with every attribute" */
    it("is the key's", () => {
      expect(isKeyOwnBudget(crossing({}))).toBe(true);
    });
  });

  describe("given one end user's bucket of a budget attributed per end user to the key", () => {
    /** @scenario "A crossing of a budget attributed per end user sends nothing" */
    it("is not the key's, though it names the key", () => {
      const endUserBucket = crossing({
        scope_type: "attributed_user",
        bucket_scope_id: "vk_1:end-user-1",
        end_user_id: "end-user-1",
      });

      expect(isKeyOwnBudget(endUserBucket)).toBe(false);
    });
  });

  describe("given an organization, project, team, principal or group budget", () => {
    /** @scenario "A crossing of an organization, project or team budget sends nothing" */
    it("is not the key's, naming no key", () => {
      for (const scope of ["organization", "project", "team", "principal", "group"]) {
        const keyless = crossing({ scope_type: scope, virtual_key_id: null });

        expect(isKeyOwnBudget(keyless), scope).toBe(false);
      }
    });
  });
});

describe("fireKeyFirstRequest", () => {
  const signal = keyFirstRequestSignal({
    data: {
      tenantId: "project-1",
      organization_id: "org-1",
      virtual_key_id: "vk_1",
      occurred_at: 3_000,
    },
    userId: "user-holder",
  });

  describe("given a key's first request told to its holder", () => {
    /** @scenario "A key's first request sets has_app_request on the person told of the key" */
    it("is one identify setting has_app_request true, and no track", () => {
      expect(fireGatewayKeySignal(signal)).toEqual([
        { type: "identify", userId: "user-holder", traits: { has_app_request: true } },
      ]);
    });

    it("is claimed once per key", () => {
      expect(signal).toMatchObject({
        kind: "key_first_request",
        sourceEventId: "vk_1:first_request",
      });
    });
  });
});

describe("keyTopModelOf", () => {
  describe("given gateway's top model and its share of the spend", () => {
    /** @scenario "A threshold crossing names the model the key spent most on" */
    it("is the model with its share as a whole percent, rounded", () => {
      expect(keyTopModelOf({ top_model: "gpt-5-mini", top_model_spend_share: 0.624 })).toEqual({
        topModel: "gpt-5-mini",
        topModelShare: 62,
      });
      expect(keyTopModelOf({ top_model: "gpt-5-mini", top_model_spend_share: 1 })).toEqual({
        topModel: "gpt-5-mini",
        topModelShare: 100,
      });
      expect(keyTopModelOf({ top_model: "gpt-5-mini", top_model_spend_share: 0.5 })).toEqual({
        topModel: "gpt-5-mini",
        topModelShare: 50,
      });
    });
  });

  describe("given a fact naming no model, or a model without its share", () => {
    /** @scenario "A crossing that names no top model sends no top-model properties" */
    it("is neither", () => {
      expect(keyTopModelOf({})).toEqual({});
      expect(keyTopModelOf({ top_model: null, top_model_spend_share: null })).toEqual({});
      expect(keyTopModelOf({ top_model: "gpt-5-mini" })).toEqual({});
      expect(keyTopModelOf({ top_model_spend_share: 0.62 })).toEqual({});
    });
  });
});

describe("fireKeyBudgetThreshold", () => {
  const signal: KeyBudgetThresholdSignal = {
    kind: "key_budget_threshold",
    sourceEventId: "budget-1:threshold_crossed:1000000:vk_1",
    tenantId: "project-1",
    occurredAt: 5_000,
    userId: "user-holder",
    organizationId: "org-1",
    virtualKeyId: "vk_1",
    keyName: "Jane's key",
    limitUsd: 100,
    spentUsd: 84.5,
    reached: false,
    onBreach: "warn",
    window: "month",
    scopeType: "virtual_key",
  };
  const propertiesOf = (sent: KeyBudgetThresholdSignal) => {
    const [call] = fireKeyBudgetThreshold(sent);
    return call?.type === "track" ? call.properties : undefined;
  };

  describe("given a signal naming the key's top model", () => {
    /** @scenario "A threshold crossing names the model the key spent most on" */
    it("tracks key_top_model and key_top_model_share alongside every other property", () => {
      expect(propertiesOf({ ...signal, topModel: "gpt-5-mini", topModelShare: 62 })).toMatchObject({
        key_name: "Jane's key",
        key_budget: 100,
        key_spend: 84.5,
        key_top_model: "gpt-5-mini",
        key_top_model_share: 62,
      });
    });
  });

  describe("given a signal naming none", () => {
    /** @scenario "A crossing that names no top model sends no top-model properties" */
    it("leaves both properties out rather than sending null", () => {
      for (const sent of [signal, { ...signal, topModel: null, topModelShare: null }]) {
        const properties = propertiesOf(sent);

        expect(properties).not.toHaveProperty("key_top_model");
        expect(properties).not.toHaveProperty("key_top_model_share");
      }
    });
  });
});
