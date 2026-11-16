/**
 * @vitest-environment node
 * Gateway writes the ledger row from data-privacy's priced PII redaction model call through its own
 * peer subscriber (ADR-201); a repeat request id is one confirm, kept once.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import {
  PII_REDACTION_REQUEST_TYPE,
  PII_REDACTION_SPEND_AGGREGATE_TYPE,
  PII_REDACTION_SPEND_EVENT_VERSION,
  PII_REDACTION_SPEND_MODEL,
  PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
  type PiiRedactionSpendPricedEventData,
  piiRedactionSpendPricedEventDataSchema,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSchema,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { GatewayPricedSpend, GatewayPricedSpendResult } from "@langwatch/gateway-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GatewayPiiRedactionSpendService } from "../../features/spend/services/gateway-pii-redaction-spend.service.ts";
import { pricedSpendCommandData } from "../../rules/gateway-spend-command.rules.ts";
import { buildGatewayPiiRedactionSpendPipeline } from "../gateway-pii-redaction-spend.pipeline.ts";
import { ConfirmSpendCommand } from "../gateway-spend.intent.ts";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const TEAM_ID = "team-1";
const OCCURRED_AT = Date.UTC(2026, 10, 11);

/** data-privacy's pipeline as its contract names the fact. */
function dataPrivacyStandIn() {
  return definePipeline({
    name: "data_privacy_pii_redaction_spend_stand_in",
    aggregate: defineAggregate({ type: PII_REDACTION_SPEND_AGGREGATE_TYPE }),
  })
    .withEvents([
      z.object({
        ...EventSchema.shape,
        type: z.literal(PII_REDACTION_SPEND_PRICED_EVENT_TYPE),
        data: piiRedactionSpendPricedEventDataSchema,
      }),
    ])
    .build();
}

/** One model call of 1,000 characters, as data-privacy appends it. */
function pricedFact(): PiiRedactionSpendPricedEventData {
  return {
    tenantId: ORGANIZATION_ID,
    occurredAt: OCCURRED_AT,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    requestId: "piiredaction_0123456789abcdef0123456789abcdef",
    model: PII_REDACTION_SPEND_MODEL,
    rateVersion: "pii_redaction@500nano_per_char",
    characters: 1_000,
    texts: 2,
    priceNanoUsd: 500_000,
    costNanoUsd: 93_534,
  };
}

function projectWithTeam(): ProjectWithTeam {
  return {
    id: PROJECT_ID,
    team: { id: TEAM_ID, organizationId: ORGANIZATION_ID },
  } as ProjectWithTeam;
}

function harness({
  project = projectWithTeam(),
  result = { status: "recorded" },
}: {
  project?: ProjectWithTeam | null;
  result?: GatewayPricedSpendResult;
} = {}) {
  const recorded: GatewayPricedSpend[] = [];
  const logger = { error: vi.fn() };
  const spend = GatewayPiiRedactionSpendService.create({
    projects: { findWithTeam: async (id) => (id === PROJECT_ID ? project : null) },
    recordPricedSpend: async (input) => {
      recorded.push(input);
      return result;
    },
    logger,
  });
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const dataPrivacy = eventing.register(dataPrivacyStandIn());
  eventing.register(buildGatewayPiiRedactionSpendPipeline({ spend }));
  const append = (data: PiiRedactionSpendPricedEventData, id: string) =>
    dataPrivacy.service.storeEvents(
      [
        {
          id,
          aggregateId: data.organizationId,
          aggregateType: PII_REDACTION_SPEND_AGGREGATE_TYPE,
          tenantId: createTenantId(data.tenantId),
          type: PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
          version: PII_REDACTION_SPEND_EVENT_VERSION,
          createdAt: data.occurredAt,
          occurredAt: data.occurredAt,
          data,
        },
      ],
      { tenantId: createTenantId(data.tenantId) },
    );
  return { eventing, append, recorded, logger, spend };
}

/** The spend spine's own key for a confirm: the one its event store keeps once. */
async function confirmKeyOf(input: GatewayPricedSpend): Promise<string | undefined> {
  const data = pricedSpendCommandData(input) as Parameters<
    ConfirmSpendCommand["handle"]
  >[0]["data"];
  const [event] = await new ConfirmSpendCommand().handle({
    tenantId: createTenantId(input.projectId),
    aggregateId: input.requestId,
    type: ConfirmSpendCommand.schema.type,
    data,
  } as Parameters<ConfirmSpendCommand["handle"]>[0]);
  return event?.idempotencyKey;
}

describe("given gateway's PII redaction spend pipeline beside data-privacy's priced fact", () => {
  describe("when data-privacy records a priced model call", () => {
    /** @scenario "The ledger row carries the price as its cost and names the PII redaction model" */
    it("writes one confirmed row at the customer price under the project and its team", async () => {
      const { eventing, append, recorded } = harness();

      await append(pricedFact(), "evt-priced-1");
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      expect(recorded[0]).toEqual({
        requestId: "piiredaction_0123456789abcdef0123456789abcdef",
        projectId: PROJECT_ID,
        organizationId: ORGANIZATION_ID,
        teamId: TEAM_ID,
        requestType: PII_REDACTION_REQUEST_TYPE,
        model: PII_REDACTION_SPEND_MODEL,
        rateVersion: "pii_redaction@500nano_per_char",
        inputTokens: 0,
        costNanoUsd: 500_000,
        metadata: JSON.stringify({
          pii_redaction: { cost_usd: 0.000093534, characters: 1_000, texts: 2 },
        }),
        occurredAt: OCCURRED_AT,
      });
      await eventing.close();
    });
  });

  describe("when a free organization's call is priced at zero", () => {
    /** @scenario "A free organization's call is recorded at a price of zero" */
    it("still writes the row, at zero, with our cost in the metadata", async () => {
      const { eventing, append, recorded } = harness();

      await append({ ...pricedFact(), priceNanoUsd: 0 }, "evt-free");
      await vi.waitFor(() => expect(recorded).toHaveLength(1));

      expect(recorded[0]).toMatchObject({ costNanoUsd: 0 });
      expect(JSON.parse(recorded[0]?.metadata ?? "{}")).toMatchObject({
        pii_redaction: { cost_usd: 0.000093534 },
      });
      await eventing.close();
    });
  });

  describe("when a second priced event with a new event id carries the same request id", () => {
    /** @scenario "The same span redacted twice is one request" */
    it("sends the same confirm twice, which the spend spine keeps as one row", async () => {
      const { eventing, append, recorded } = harness();

      await append(pricedFact(), "evt-priced-1");
      await append({ ...pricedFact(), occurredAt: OCCURRED_AT + 1_000 }, "evt-priced-2");
      await vi.waitFor(() => expect(recorded).toHaveLength(2));

      const [first, second] = await Promise.all(recorded.map(confirmKeyOf));
      expect(first).toBeDefined();
      expect(second).toBe(first);
      await eventing.close();
    });
  });
});

describe("given a priced PII redaction fact the gateway cannot place", () => {
  describe("when its project no longer exists", () => {
    /** @scenario "A fact for a project with no team is logged, not written" */
    it("logs the request and its price and writes nothing", async () => {
      const { spend, recorded, logger } = harness({ project: null });

      await spend.recordPiiRedactionSpend({ fact: pricedFact() });

      expect(recorded).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          requestId: pricedFact().requestId,
          priceNanoUsd: 500_000,
        },
        expect.stringContaining("PII redaction spend"),
      );
    });
  });

  describe("when this process has no spend pipeline registered", () => {
    /** @scenario "A spend pipeline that is not registered makes the fact be delivered again" */
    it("throws, so the fact is delivered again rather than dropped", async () => {
      const { spend } = harness({ result: { status: "unavailable" } });

      await expect(spend.recordPiiRedactionSpend({ fact: pricedFact() })).rejects.toThrow(
        /spend pipeline/,
      );
    });
  });
});
