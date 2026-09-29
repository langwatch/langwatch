// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordNurturingSignalCommand } from "../nurturing-signal.commands.ts";

const signal: NurturingSignal = {
  kind: "scenario_created",
  sourceEventId: "event-1",
  tenantId: "project-1",
  occurredAt: 1_500,
  userId: "user-1",
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioCount: 3,
};

describe("RecordNurturingSignalCommand", () => {
  describe("when an owner records the same source event twice", () => {
    /** @scenario "An owner's signal lands on nurturing's pipeline keyed by its source event" */
    it("records the same aggregate and idempotency key both times", () => {
      const command = new RecordNurturingSignalCommand();
      const send = () =>
        command.handle({
          tenantId: createTenantId("project-1"),
          aggregateId: "scenario_created:event-1",
          type: "lw.nurturing.record_signal",
          data: { tenantId: "project-1", occurredAt: 1_500, signal },
        })[0];

      const [first, second] = [send(), send()];

      expect(first?.aggregateId).toBe("scenario_created:event-1");
      expect(first?.idempotencyKey).toBe("scenario_created:event-1");
      expect(second?.idempotencyKey).toBe(first?.idempotencyKey);
      expect(first?.data.signal).toEqual(signal);
    });
  });
});
