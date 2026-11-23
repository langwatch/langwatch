/**
 * @vitest-environment node
 * The Cloud price for each kind of customer (decided 2026-11-23), through the whole module: a
 * span in, the model or Presidio called, and the priced facts the spend pipeline stores.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PII_REDACTION_SPEND_AGGREGATE_TYPE,
  type PiiRedactionSpendPricedEventData,
  piiRedactionSpendPricedEventDataSchema,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import {
  PII_REDACTION_MODEL_FLAG,
  PII_REDACTION_MODEL_FREE_FLAG,
} from "../../rules/pii-redaction-model.rules.ts";
import { createDataPrivacyTestApp, dataPrivacyTestGraph } from "./data-privacy.fixture.ts";

const { projectId: PROJECT_ID, organizationId: ORGANIZATION_ID } = dataPrivacyTestGraph;

/** A synthetic text of `length` characters: only names and places, which Strict alone finds. */
function textOf(length: number): string {
  const sentence = "Maria Lopez from Rotterdam asked about her order on Tuesday. ";
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}

const LONG_SPAN = textOf(7_900);
const SIMPLE_SPAN = textOf(50);
const OVER_THE_CAP_SPAN = textOf(12_000);
/** 47 characters, of which standard detection masks the phone number in-process. */
const SPAN_WITH_A_PHONE = "Hi, I'm Maria Lopez, call me on +31 6 1234 5678";

function spanWith({ spanId, input }: { spanId: string; input: string }): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId,
    name: "llm",
    kind: 1,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [{ key: "langwatch.input", value: { stringValue: input } }],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

/** An analyser that answers each of `calls` one-text batches with `redacted`. */
function analyserAnswering({ redacted, calls }: { redacted: string; calls: number }) {
  const channel = MemoryPresidioChannel.create({ endpoint: "http://analyser:8080" });
  for (let call = 0; call < calls; call++) {
    channel.answerWith({
      kind: "detected",
      results: [{ status: "processed", raw_response: { anonymized: redacted } }],
    });
  }
  // The empty batch is the configured probe, not a call.
  const batches = () => channel.batches.filter((batch) => batch.texts.length > 0);
  return { channel, batches };
}

const permissions = createApiFixture<AuthzApi>({
  checkScopeLineage: async () => ({ kind: "consistent" }),
});
const entitlements = createApiFixture<EntitlementApi>();

/** One Cloud organization with the model flag on, its project at `level`, and its spend stored. */
async function cloudCustomer({ free, level }: { free: boolean; level: "STRICT" | "ESSENTIAL" }) {
  const model = analyserAnswering({ redacted: "<redacted by the model>", calls: 2 });
  const presidio = analyserAnswering({ redacted: "<redacted by Presidio>", calls: 1 });
  const flags = new Set([
    PII_REDACTION_MODEL_FLAG,
    ...(free ? [PII_REDACTION_MODEL_FREE_FLAG] : []),
  ]);
  const app = await createDataPrivacyTestApp({
    dependencies: {
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: async (key) => flags.has(key),
      }),
      permissions,
      entitlements,
    },
    settings: {
      isSaas: true,
      langevalsEndpoint: "http://langevals:5562",
      piiRedactionModelEndpoint: "http://pii-redaction-model:8080",
    },
    channels: async () => ({
      presidio: presidio.channel,
      piiRedactionModel: model.channel,
      dlp: MemoryGoogleDlpChannel.create(),
    }),
  });
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
  });
  app.connectSpendCommands(eventing.register(app.spendPipeline()).commands);
  await app.setPiiRedactionLevel({ projectId: PROJECT_ID, level });

  const send = async (span: OtlpSpan) => {
    await app.redactSpan({
      span,
      resource: null,
      piiRedactionLevel: "ESSENTIAL",
      tenantId: PROJECT_ID,
    });
    return span.attributes[0]?.value.stringValue;
  };
  const priced = async (): Promise<PiiRedactionSpendPricedEventData[]> => {
    const events = await eventStore.getEvents({
      aggregateId: ORGANIZATION_ID,
      context: { tenantId: createTenantId(ORGANIZATION_ID) },
      aggregateType: PII_REDACTION_SPEND_AGGREGATE_TYPE,
    });
    return events.map((event) => piiRedactionSpendPricedEventDataSchema.parse(event.data));
  };
  return { send, priced, model, presidio };
}

describe("given the Cloud price of the PII redaction model", () => {
  describe("when a paying organization with a Strict project sends a long and a simple span", () => {
    /** @scenario "A paying organization's long and simple spans are each priced by their characters" */
    it("prices each span at 500 nano dollars per character, from the first one", async () => {
      const customer = await cloudCustomer({ free: false, level: "STRICT" });

      const long = await customer.send(spanWith({ spanId: "span-long", input: LONG_SPAN }));
      const simple = await customer.send(spanWith({ spanId: "span-simple", input: SIMPLE_SPAN }));

      expect([long, simple]).toEqual(["<redacted by the model>", "<redacted by the model>"]);
      expect(customer.presidio.batches()).toEqual([]);
      const [longFact, simpleFact] = await customer.priced();
      expect(longFact).toMatchObject({
        characters: 7_900,
        texts: 1,
        priceNanoUsd: 3_950_000,
        rateVersion: "pii_redaction@500nano_per_char",
        model: "pii-redaction-model",
      });
      expect(simpleFact).toMatchObject({
        characters: 50,
        texts: 1,
        priceNanoUsd: 25_000,
        rateVersion: "pii_redaction@500nano_per_char",
      });
      expect(longFact?.requestId).not.toBe(simpleFact?.requestId);
    });
  });

  describe("when a paying organization's span holds a phone number", () => {
    /** @scenario "The characters priced are the ones sent to the model, after standard detection" */
    it("prices the characters of the text the model was sent, the phone number already masked", async () => {
      const customer = await cloudCustomer({ free: false, level: "STRICT" });

      await customer.send(spanWith({ spanId: "span-phone", input: SPAN_WITH_A_PHONE }));

      const [sent] = customer.model.batches().map((batch) => batch.texts);
      expect(sent).toHaveLength(1);
      expect(sent?.[0]).not.toContain("+31 6 1234 5678");
      const characters = sent?.[0]?.length ?? 0;
      expect(characters).toBeLessThan(SPAN_WITH_A_PHONE.length);
      expect(await customer.priced()).toEqual([
        expect.objectContaining({ characters, priceNanoUsd: characters * 500 }),
      ]);
    });
  });

  describe("when a free organization with a Strict project sends a long span", () => {
    /** @scenario "A free organization's long spans are recorded at zero with our cost kept" */
    it("records the call at a price of zero and keeps our cost", async () => {
      const customer = await cloudCustomer({ free: true, level: "STRICT" });

      const redacted = await customer.send(spanWith({ spanId: "span-long", input: LONG_SPAN }));

      expect(redacted).toBe("<redacted by the model>");
      const facts = await customer.priced();
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ characters: 7_900, priceNanoUsd: 0 });
      expect(facts[0]?.costNanoUsd).toBeGreaterThan(0);
    });
  });

  describe("when a Strict organization sends a span over the model's length cap", () => {
    /** @scenario "A span over the model's length cap is redacted by Presidio and priced for nobody" */
    it.each([
      { customer: "a paying organization", free: false },
      { customer: "a free organization", free: true },
    ])("redacts $customer's span through Presidio and prices nothing", async ({ free }) => {
      const customer = await cloudCustomer({ free, level: "STRICT" });

      const redacted = await customer.send(
        spanWith({ spanId: "span-over-the-cap", input: OVER_THE_CAP_SPAN }),
      );

      expect(redacted).toBe("<redacted by Presidio>");
      expect(customer.model.batches()).toEqual([]);
      expect(customer.presidio.batches()).toHaveLength(1);
      expect(await customer.priced()).toEqual([]);
    });
  });

  describe("when an organization that cancelled Strict's price stays on Essential", () => {
    /** @scenario "An organization that declined Strict at a price stays on Essential and is never priced" */
    it("calls neither the model nor Presidio and prices nothing", async () => {
      const customer = await cloudCustomer({ free: false, level: "ESSENTIAL" });

      await customer.send(spanWith({ spanId: "span-long", input: LONG_SPAN }));
      await customer.send(spanWith({ spanId: "span-simple", input: SIMPLE_SPAN }));

      expect(customer.model.batches()).toEqual([]);
      expect(customer.presidio.batches()).toEqual([]);
      expect(await customer.priced()).toEqual([]);
    });
  });
});
