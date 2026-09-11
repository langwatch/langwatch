/**
 * Unit coverage for the puller framework's NormalizedPullEvent → OCSF row
 * mapping. The full effect shape (Prisma + CH + process outbox) is exercised
 * by the integration tier; this file covers the pure mapping the worker calls
 * (eventId composition, raw_event preservation, time-coercion fallback, and
 * which actor field a provider's actor string lands in).
 *
 * The real `mapToOcsfRow` is imported, not re-implemented: an earlier version
 * of this file kept a hand-copied "semantic contract" beside the worker's
 * mapper, which passed happily while the mapper itself put opaque ids in the
 * email column.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import { describe, expect, it } from "vitest";

import { mapToOcsfRow, ocsfActorFields } from "../ocsfPullEventMapping";
import { PULLED_USAGE_HINT_KEY } from "../pulledUsageRecord";
import type { NormalizedPullEvent } from "../pullerAdapter";

const baseEvent: NormalizedPullEvent = {
  source_event_id: "evt-123",
  event_timestamp: "2026-05-03T10:00:00Z",
  actor: "alice@acme.test",
  action: "completion",
  target: "gpt-5-mini",
  cost_usd: "0.0023",
  tokens_input: 50,
  tokens_output: 12,
  raw_payload: '{"id":"evt-123","raw":"data"}',
};

function mapEvent(event: NormalizedPullEvent) {
  return mapToOcsfRow({
    event,
    tenantId: "gov-proj-1",
    ingestionSourceId: "src-1",
    sourceType: "copilot_studio",
  });
}

function actorOf(rawOcsfJson: string): {
  user: { uid: string; email_addr: string };
} {
  return (
    JSON.parse(rawOcsfJson) as {
      actor: { user: { uid: string; email_addr: string } };
    }
  ).actor;
}

describe("given a pulled provider event", () => {
  describe("when the worker maps it to an OCSF audit row", () => {
    it("composes eventId as `<sourceType>:<sourceId>:<source_event_id>`", () => {
      const row = mapEvent(baseEvent);

      expect(row.eventId).toBe("copilot_studio:src-1:evt-123");
      expect(row.traceId).toBe("pull:copilot_studio:src-1:evt-123");
    });

    it("carries the tenant id it was handed through untouched", () => {
      // The caller passes the org's hidden internal_governance project id —
      // the same key the trace-fold subscriber and the OCSF export service
      // use, so pull events surface alongside trace-derived ones on the SIEM
      // export path. Which id that is, is the caller's decision and is not
      // established here; all the mapping owes is to not rewrite it.
      const row = mapToOcsfRow({
        event: baseEvent,
        tenantId: "gov-proj-acme-42",
        ingestionSourceId: "src-1",
        sourceType: "copilot_studio",
      });

      expect(row.tenantId).toBe("gov-proj-acme-42");
    });

    it("carries action and target through without transformation", () => {
      const row = mapEvent(baseEvent);

      expect(row.actionName).toBe("completion");
      expect(row.targetName).toBe("gpt-5-mini");
    });

    it("preserves the provider's raw payload under the OCSF extension", () => {
      const row = mapEvent(baseEvent);
      const extension = (
        JSON.parse(row.rawOcsfJson) as {
          metadata: { extension: { raw_event: string } };
        }
      ).metadata.extension;

      expect(extension.raw_event).toBe('{"id":"evt-123","raw":"data"}');
    });
  });

  describe("when event_timestamp is unparseable", () => {
    it("falls back to a usable time rather than an invalid date", () => {
      const row = mapEvent({ ...baseEvent, event_timestamp: "not-a-date" });

      expect(row.eventTime).toBeInstanceOf(Date);
      expect(Number.isFinite(row.eventTime.getTime())).toBe(true);
    });
  });
});

describe("given a provider that names the actor by an address", () => {
  describe("when the row is mapped", () => {
    it("records the address verbatim in the actor email field", () => {
      const row = mapEvent(baseEvent);

      expect(row.actorEmail).toBe("alice@acme.test");
      expect(row.actorUserId).toBe("");
      expect(actorOf(row.rawOcsfJson).user).toEqual({
        uid: "",
        email_addr: "alice@acme.test",
      });
    });

    it("keeps the provider's own casing rather than normalizing it", () => {
      // An audit row states what the provider said. Matching is where an
      // address gets lowercased, and it does its own normalizing.
      const row = mapEvent({ ...baseEvent, actor: "M.Silva@Acme.test" });

      expect(row.actorEmail).toBe("M.Silva@Acme.test");
    });
  });
});

describe("given a provider that names the actor by an opaque id", () => {
  describe("when the row is mapped", () => {
    it("routes the id to the actor id field, not the email field", () => {
      // What is pinned here is the placement rule, not a permanently empty
      // column: the mapper places the actor string by what that string IS, and
      // an opaque id is not an address. The SIEM export ships the email column
      // to a customer's own tooling, which reads it as an address.
      //
      // The OpenAI cost report does send a `user_email` beside the `user-…`
      // id — every one of the 2,720 captured rows carries both — but the
      // adapter deliberately puts the id in `actor`, so an address is not what
      // this mapping is handed. Whether the column should instead be filled
      // from the payload's address is an open question about the adapter, and
      // this case does not settle it either way.
      const row = mapEvent({ ...baseEvent, actor: "user-A1b2C3d4E5" });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("user-A1b2C3d4E5");
      expect(actorOf(row.rawOcsfJson).user).toEqual({
        uid: "user-A1b2C3d4E5",
        email_addr: "",
      });
    });

    it("keeps a directory GUID out of the actor email field too", () => {
      const row = mapEvent({
        ...baseEvent,
        actor: "11111111-2222-3333-4444-555555555555",
      });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("11111111-2222-3333-4444-555555555555");
    });
  });
});

describe("given a provider that names nobody", () => {
  describe("when the row is mapped", () => {
    it("leaves every actor field blank", () => {
      const row = mapEvent({ ...baseEvent, actor: "" });

      expect(row.actorEmail).toBe("");
      expect(row.actorUserId).toBe("");
      expect(row.actorEnduserId).toBe("");
    });
  });
});

describe("given the actor-field placement rule on its own", () => {
  describe("when it is handed strings adapters actually emit", () => {
    it("routes addresses to email and everything else to the user id", () => {
      expect(ocsfActorFields("dana.hoffman@acme.test")).toEqual({
        actorEmail: "dana.hoffman@acme.test",
        actorUserId: "",
      });
      // A user principal name is address-shaped and reaches us as one.
      expect(ocsfActorFields("dana@acme.onmicrosoft.test")).toEqual({
        actorEmail: "dana@acme.onmicrosoft.test",
        actorUserId: "",
      });
      // Not addresses, however much they look like identifiers of people.
      expect(ocsfActorFields("user-A1b2C3d4E5")).toEqual({
        actorEmail: "",
        actorUserId: "user-A1b2C3d4E5",
      });
      expect(ocsfActorFields("Dana Hoffman")).toEqual({
        actorEmail: "",
        actorUserId: "Dana Hoffman",
      });
      expect(ocsfActorFields("Dana Hoffman <dana@acme.test>")).toEqual({
        actorEmail: "",
        actorUserId: "Dana Hoffman <dana@acme.test>",
      });
    });
  });
});

/**
 * What the SIEM export says about money.
 *
 * The extension's amount key is read here rather than the whole extension,
 * because the two rules below are about the SHAPE of that pair: an amount and
 * the currency it is denominated in, side by side, neither of them buried in
 * the adapter's own bag of hint fields.
 *
 * The names asserted (`cost_amount`, `cost_currency`) are this binding's
 * choice; the settlement fixes the rule and not the spelling. Change them
 * together with the mapper if the implementer prefers others.
 */
function moneyOf(rawOcsfJson: string): Record<string, unknown> {
  return (
    JSON.parse(rawOcsfJson) as {
      metadata: { extension: Record<string, unknown> };
    }
  ).metadata.extension;
}

/** A euro-billed daily bill, as the Azure adapter hands one over. */
function euroBillEvent(
  overrides: Partial<NormalizedPullEvent> = {},
): NormalizedPullEvent {
  return {
    source_event_id: "azure_cost:sub_test:2026-01-15:Foundry Models",
    event_timestamp: "2026-01-15T00:00:00.000Z",
    actor: "",
    action: "cost_report",
    target: "Foundry Models",
    // The offence this scenario is about: a euro figure sitting in a field
    // whose name says dollars, because the canonical event predates
    // currencies.
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: "{}",
    extra: {
      subscriptionId: "sub_test",
      [PULLED_USAGE_HINT_KEY]: {
        costBasis: "provider_reported",
        costStatus: "exact",
        dimensions: { granularity: "1d", meterCategory: "Foundry Models" },
        costUsd: "12.34",
        currency: "EUR",
        costUsdBiller: "13.50",
        model: "Foundry Models",
      },
    },
    ...overrides,
  };
}

function mapBill(event: NormalizedPullEvent) {
  return mapToOcsfRow({
    event,
    tenantId: "gov-proj-1",
    ingestionSourceId: "src_a",
    sourceType: "copilot_studio_dataverse",
  });
}

describe("given a pulled record a provider billed in its own currency", () => {
  describe("when the record is prepared for export", () => {
    /** @scenario "An exported usage record names the currency beside its amount" */
    it("carries the amount and its currency side by side, under no dollar name", () => {
      const money = moneyOf(mapBill(euroBillEvent()).rawOcsfJson);

      // The pair, at the top of the extension where a reader taking the
      // export at face value will find it — not folded inside the adapter's
      // own hint, which is where the currency used to be the only copy.
      expect(money.cost_amount).toBe("12.34");
      expect(money.cost_currency).toBe("EUR");
      // And the amount does not travel under a name that says dollars. A
      // reader that keys on `cost_usd` must not be handed euros by it.
      expect(money.cost_usd).not.toBe("12.34");
    });
  });
});

describe("given an adapter whose extra bag names a canonical money field", () => {
  describe("when the record is prepared for export", () => {
    /** @scenario "An exported usage record names the currency beside its amount" */
    it("keeps the pair the event stated rather than the one the bag names", () => {
      // `extra` is an open record, and for the config-driven adapters its keys
      // are whatever an administrator typed into the event mapping. A key that
      // collides with a canonical name must not be able to re-denominate the
      // amount beside it.
      const money = moneyOf(
        mapBill(
          euroBillEvent({
            cost_amount: "12.34",
            cost_currency: "EUR",
            extra: { cost_currency: "USD", cost_amount: "999.99" },
          }),
        ).rawOcsfJson,
      );

      expect(money.cost_amount).toBe("12.34");
      expect(money.cost_currency).toBe("EUR");
    });
  });
});

describe("given a day whose cost was read once and exported", () => {
  describe("when a later read reports a different figure for that same day", () => {
    /** @scenario "A cost row read again replaces the record it already exported" */
    it("exports the newer figure under the identity the first read used", () => {
      const first = mapBill(euroBillEvent());
      const corrected = mapBill(
        euroBillEvent({
          extra: {
            subscriptionId: "sub_test",
            [PULLED_USAGE_HINT_KEY]: {
              costBasis: "provider_reported",
              costStatus: "exact",
              dimensions: {
                granularity: "1d",
                meterCategory: "Foundry Models",
              },
              costUsd: "19.99",
              currency: "EUR",
              costUsdBiller: "21.80",
              model: "Foundry Models",
            },
          },
        }),
      );

      // One id, so the export table replaces rather than appends: no second
      // record is added for the same day.
      expect(corrected.eventId).toBe(first.eventId);
      expect(moneyOf(corrected.rawOcsfJson).cost_amount).toBe("19.99");
    });
  });
});
