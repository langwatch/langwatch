// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Whether the withdrawal the ledger dispatches is a payload the command will
 * actually accept.
 *
 * The reissue detector's own tests mock the dispatcher and assert the cell it
 * was handed, which says nothing about whether the command takes it. It did
 * not: every command payload carries `tenantId` and `occurredAt`, the
 * withdrawal carried neither, and the send was rejected by validation before
 * it could become an event. Nothing downstream ran — no `RETRACTED` reached
 * the fold, and the drift check never put the corrected day back on its list.
 *
 * The gap survived because the command is resolved late, through a mutable
 * holder filled once the pipeline exists, and the cast at that seam removed
 * the one check that would have caught it. So this pins the contract at the
 * schema rather than at a shape: the assertion runs the REAL command schema —
 * the event data schema with the envelope merged in, exactly as `defineCommand`
 * derives it — over the payload the process actually produced.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-088, ADR-128.
 */

import { pulledUsageRetractedEventDataSchema } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import { withCommandEnvelope } from "~/server/event-sourcing/commands/commandEnvelope";

import {
  type PulledUsageLedgerProcessDeps,
  type RetractPulledUsagePayload,
  runRetractPulledUsage,
} from "../pulledUsageLedger.process";

const ns = `pulled-retract-${nanoid(8)}`;

/** The day the withdrawal corrects — never the day the correction arrived. */
const OCCURRED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
const OBSERVED_AT = Date.UTC(2026, 7, 3, 9, 15, 0);

/**
 * The command payload schema as the runtime derives it: the event data plus
 * the envelope every command carries. Built here the same way `defineCommand`
 * builds it, so a field added to either side is checked here too.
 */
const retractCommandSchema = withCommandEnvelope(
  pulledUsageRetractedEventDataSchema,
);

function withdrawalPayload(): RetractPulledUsagePayload {
  return {
    restatement_key: `restate-${ns}`,
    tenant_id: `proj-gov-${ns}`,
    organization_id: `org-${ns}`,
    source: "azure_cost_management",
    ingestion_source_id: `src-${ns}`,
    model: "gpt-5-mini",
    currency_code: "EUR",
    agent_id: `agent-${ns}`,
    raw_actor_id: `actor-${ns}`,
    occurred_at_ms: OCCURRED_AT,
    observed_at_ms: OBSERVED_AT,
  };
}

/** Runs the withdrawal and hands back the payload the command was given. */
async function dispatchWithdrawal(): Promise<{
  dispatched: unknown;
  sends: number;
}> {
  const sendRetractPulledUsage = vi.fn().mockResolvedValue(undefined);
  const deps = {
    retractionEnabled: async () => true,
    sendRetractPulledUsage,
  } as unknown as PulledUsageLedgerProcessDeps;

  await runRetractPulledUsage(deps)(withdrawalPayload());

  return {
    dispatched: sendRetractPulledUsage.mock.calls[0]?.[0],
    sends: sendRetractPulledUsage.mock.calls.length,
  };
}

describe("dispatching a withdrawal for a superseded charge", () => {
  describe("given a reissue the withdrawal switch allows", () => {
    /** @scenario A bill reissued in another currency is withdrawn by the pull that finds it */
    it("hands the command a payload the command schema accepts", async () => {
      const { dispatched, sends } = await dispatchWithdrawal();
      expect(sends).toBe(1);

      const parsed = retractCommandSchema.safeParse(dispatched);

      // Reported rather than asserted bare: a rejection here is the whole
      // defect, and the issue list names the field that would be dropped.
      expect(
        parsed.success ? [] : parsed.error.issues.map((issue) => issue.path),
      ).toEqual([]);
      expect(parsed.success).toBe(true);
    });

    it("dates the withdrawal by the day it corrects, not by the pull that found it", async () => {
      const { dispatched } = await dispatchWithdrawal();

      expect(dispatched).toMatchObject({
        tenantId: `proj-gov-${ns}`,
        occurredAt: OCCURRED_AT,
        occurredAtMs: OCCURRED_AT,
        observedAtMs: OBSERVED_AT,
      });
    });
  });
});
