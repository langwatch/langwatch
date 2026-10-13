// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What each ingestion-pull command writes onto its telemetry span. The withheld person count stays
 * off every span because its movement dates an erasure.
 * Spec: specs/ai-governance/dashboard/provider-data-boundaries.feature
 */
import { describe, expect, it } from "vitest";

import { IngestionPullEventingAdapter } from "../ingestion-pull.pipeline.ts";

const WITHHELD_SENTINEL = 7919;
const ENVELOPE = { tenantId: "gov_project", occurredAt: 1_700_000_000_000 };
const LISTING = { sourceId: "src_1", requestId: "req_1" };
const REFUSAL = { ...LISTING, requestedAt: 1_700_000_000_000, reason: "refused", status: 403 };

const commands = IngestionPullEventingAdapter.commandHandlers();

const attributesByCommand = {
  configure: {
    attributes: commands.configure.getSpanAttributes?.({
      ...ENVELOPE,
      sourceId: "src_1",
      cron: "0 * * * *",
      configVersion: "v1",
      cursor: null,
    }),
    declared: ["payload.source_id"],
  },
  disable: {
    attributes: commands.disable.getSpanAttributes?.({
      ...ENVELOPE,
      sourceId: "src_1",
      configVersion: "v1",
    }),
    declared: ["payload.source_id"],
  },
  recordRunCompleted: {
    attributes: commands.recordRunCompleted.getSpanAttributes?.({
      ...ENVELOPE,
      sourceId: "src_1",
      runId: "run_1",
      scheduledFor: 1,
      nextCursor: null,
      eventCount: 3,
    }),
    declared: ["payload.event_count", "payload.run_id", "payload.source_id"],
  },
  recordRunFailed: {
    attributes: commands.recordRunFailed.getSpanAttributes?.({
      ...ENVELOPE,
      sourceId: "src_1",
      runId: "run_1",
      scheduledFor: 1,
      error: "boom",
      errorCode: "x",
      retryable: false,
    }),
    declared: ["payload.run_id", "payload.source_id"],
  },
  requestAgentsListing: {
    attributes: commands.requestAgentsListing.getSpanAttributes?.({ ...ENVELOPE, ...LISTING }),
    declared: ["payload.request_id", "payload.source_id"],
  },
  recordAgentsListed: {
    attributes: commands.recordAgentsListed.getSpanAttributes?.({
      ...ENVELOPE,
      ...LISTING,
      requestedAt: 1,
      agentCount: 4,
    }),
    declared: ["payload.agent_count", "payload.request_id", "payload.source_id"],
  },
  recordAgentsListingRefused: {
    attributes: commands.recordAgentsListingRefused.getSpanAttributes?.({
      ...ENVELOPE,
      ...REFUSAL,
    }),
    declared: ["payload.reason", "payload.request_id", "payload.source_id"],
  },
  requestPeopleListing: {
    attributes: commands.requestPeopleListing.getSpanAttributes?.({ ...ENVELOPE, ...LISTING }),
    declared: ["payload.request_id", "payload.source_id"],
  },
  recordPeopleListed: {
    attributes: commands.recordPeopleListed.getSpanAttributes?.({
      ...ENVELOPE,
      ...LISTING,
      requestedAt: 1,
      directoryPersonCount: 12,
      withheldPersonCount: WITHHELD_SENTINEL,
    }),
    declared: ["payload.directory_person_count", "payload.request_id", "payload.source_id"],
  },
  recordPeopleListingRefused: {
    attributes: commands.recordPeopleListingRefused.getSpanAttributes?.({
      ...ENVELOPE,
      ...REFUSAL,
    }),
    declared: ["payload.reason", "payload.request_id", "payload.source_id"],
  },
};

describe("the span attributes of every ingestion-pull command", () => {
  describe.each(Object.entries(attributesByCommand))("given the %s command", (_name, entry) => {
    /** @scenario "The erasure count never rides a span" */
    it("carries exactly the keys declared for it, and never the withheld person count", () => {
      expect(entry.attributes).toBeDefined();
      const attributes = entry.attributes ?? {};

      expect(Object.keys(attributes).toSorted()).toEqual(entry.declared);
      expect(Object.keys(attributes).some((key) => /withheld/i.test(key))).toBe(false);
      expect(Object.values(attributes)).not.toContain(WITHHELD_SENTINEL);
    });
  });

  describe("given the command that carries the withheld person count", () => {
    it("is the one command whose data holds it, and its span still carries only the counted people", () => {
      const spanned = attributesByCommand.recordPeopleListed.attributes ?? {};

      expect(spanned["payload.directory_person_count"]).toBe(12);
      expect(Object.keys(spanned)).not.toContain("payload.withheld_person_count");
    });
  });
});
