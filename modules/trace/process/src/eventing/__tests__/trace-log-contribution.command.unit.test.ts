/** Spec: specs/trace-processing/io-accumulation.feature */
import { createTenantId } from "@langwatch/eventing";
import {
  RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
  type RecordLogContributionCommandData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { recordLogContributionCommand } from "../trace-log-contribution.commands.ts";

const contribution = ({
  outputDeclared,
}: {
  outputDeclared?: boolean;
}): RecordLogContributionCommandData => ({
  tenantId: "project-1",
  recordId: "record-1",
  traceId: "trace-1",
  spanId: "span-1",
  timeUnixMs: 1_000,
  severityNumber: 9,
  severityText: "",
  providerKind: "claude_code",
  scopeName: "com.anthropic.claude_code.events",
  correlationSource: "wire",
  input: null,
  output: "The nightly build is green again.",
  ...(outputDeclared === undefined ? {} : { outputDeclared }),
  liftedAttributes: {},
  nonBillable: false,
  piiRedactionLevel: "ESSENTIAL",
  occurredAt: 1_000,
});

const handle = (data: RecordLogContributionCommandData) =>
  recordLogContributionCommand.create().handle({
    tenantId: createTenantId("project-1"),
    aggregateId: "trace-1",
    type: RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
    data,
  });

describe("recordLogContributionCommand", () => {
  /** @scenario "A declared output is kept over the agent's later closing text" */
  it("keeps the declared mark on the contributed event", async () => {
    const [event] = await handle(contribution({ outputDeclared: true }));

    expect(event?.data.outputDeclared).toBe(true);
  });

  it("leaves the mark off an inferred output", async () => {
    const [event] = await handle(contribution({}));

    expect(event?.data).not.toHaveProperty("outputDeclared");
  });
});
