/** Steps the kill switch suites share: wait for a status, read a refusal's code, request a stop. */
import type { AgentStopSeverity, AgentStopStatus } from "@langwatch/enterprise-governance-contract";
import { expect, vi } from "vitest";

import { AGENT_ID, type killSwitchHarness, ORG, PERSON } from "./kill-switch.fixtures.ts";

export type Harness = Awaited<ReturnType<typeof killSwitchHarness>>;

export async function settled(harness: Harness, stopId: string, status: AgentStopStatus) {
  await vi.waitFor(async () => expect((await harness.stopOf(stopId)).status).toBe(status), {
    timeout: 5_000,
  });
  return harness.stopOf(stopId);
}

export async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

export const request = (
  harness: Harness,
  caller = PERSON,
  severity: AgentStopSeverity = "high",
  expectedTargetIds?: readonly string[],
) =>
  harness.stops.requestStop({
    organizationId: ORG,
    agentId: AGENT_ID,
    reason: "prompt injection in production",
    severity,
    caller,
    ...(expectedTargetIds ? { expectedTargetIds } : {}),
  });
