/**
 * A workbench run that ends is recorded on experiment's own pipeline, which peers react to (§9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordExperimentRanCommand } from "../experiment-lifecycle.commands.ts";
import {
  RECORD_EXPERIMENT_RAN_COMMAND_TYPE,
  type RecordExperimentRanCommandData,
} from "../experiment-lifecycle.events.ts";

const ran: RecordExperimentRanCommandData = {
  tenantId: "project-1",
  occurredAt: 1_700_000_000_000,
  userId: "user-1",
  projectId: "project-1",
  experimentId: "exp-1",
  fullRun: true,
};

describe("the experiment lifecycle pipeline", () => {
  it("appends one experiment ran event keyed by the person and the instant", () => {
    const [event, ...rest] = new RecordExperimentRanCommand().handle({
      tenantId: createTenantId("project-1"),
      type: RECORD_EXPERIMENT_RAN_COMMAND_TYPE,
      aggregateId: "project-1",
      data: ran,
    });

    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: "lw.experiment.ran",
      aggregateId: "project-1",
      idempotencyKey: "project-1:user-1:ran:1700000000000",
      data: ran,
    });
  });
});
