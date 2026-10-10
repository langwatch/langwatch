// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `pulledUsageRetraction.command.unit.test.ts`: the withdrawal is one the command accepts. */
import {
  type PulledUsageRetractedEventData,
  pulledUsageRetractedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import { withCommandEnvelope } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  PulledUsageRetractionIntent,
  type RetractCommandEnvelope,
} from "../pulled-usage-retraction.intent.ts";

const OCCURRED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
const OBSERVED_AT = Date.UTC(2026, 7, 3, 9, 15, 0);

async function dispatchWithdrawal() {
  const sent: (PulledUsageRetractedEventData & RetractCommandEnvelope)[] = [];
  const intent = PulledUsageRetractionIntent.create({
    retractionEnabled: () => Promise.resolve(true),
    sendRetractPulledUsage: (data) => {
      sent.push(data);
      return Promise.resolve();
    },
  });

  await intent.execute({
    restatement_key: "restate-1",
    tenant_id: "proj-gov-1",
    organization_id: "org-1",
    source: "azure_cost_management",
    ingestion_source_id: "src-1",
    model: "gpt-5-mini",
    currency_code: "EUR",
    agent_id: "agent-1",
    raw_actor_id: "actor-1",
    occurred_at_ms: OCCURRED_AT,
    observed_at_ms: OBSERVED_AT,
  });
  return sent;
}

describe("dispatching a withdrawal for a superseded charge", () => {
  describe("given a reissue the withdrawal switch allows", () => {
    /** @scenario "A bill reissued in another currency is withdrawn by the pull that finds it" */
    it("hands the command a payload the command schema accepts", async () => {
      const sent = await dispatchWithdrawal();

      const parsed = withCommandEnvelope(pulledUsageRetractedEventDataSchema).safeParse(sent[0]);

      expect(sent).toHaveLength(1);
      expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path)).toEqual([]);
    });

    it("dates the withdrawal by the day it corrects, not by the pull that found it", async () => {
      const [dispatched] = await dispatchWithdrawal();

      expect(dispatched).toMatchObject({
        tenantId: "proj-gov-1",
        occurredAt: OCCURRED_AT,
        occurredAtMs: OCCURRED_AT,
        observedAtMs: OBSERVED_AT,
      });
    });
  });
});
