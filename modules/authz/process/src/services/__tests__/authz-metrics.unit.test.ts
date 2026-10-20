import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
/**
 * Spec: modules/authz/specs/grants-command-dispatch.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthzCutoverRepository } from "../../repositories/authz-cutover.repository.ts";
import type { AuthzRevocationReason } from "../../repositories/authz-revocation.repository.ts";
import { PrismaAuthzRevocationRepository } from "../../repositories/prisma/prisma.authz-revocation.repository.ts";
import { AuthzCutoverGateService } from "../authz-cutover-gate.service.ts";

let meter: RecordingMeterProvider;

beforeEach(() => {
  meter = createRecordingMeterProvider();
  meter.install();
});

afterEach(() => {
  meter.uninstall();
});

function writesBy(reason: AuthzRevocationReason): number {
  return meter.valueOf("langwatch_authz_direct_projection_write_total", { reason });
}

function gateReadFailures(): number {
  return meter.valueOf("authz_engine_gate_read_failures_total");
}

function revocations(): PrismaAuthzRevocationRepository {
  return PrismaAuthzRevocationRepository.create({
    database: { grant: { updateMany: async () => ({ count: 0 }) } },
  });
}

/** An engine switch whose every read fails, as a down Postgres answers. */
class FailingCutoverRepository extends AuthzCutoverRepository {
  async getEngineSwitch(): Promise<never> {
    throw new Error("pg is down");
  }

  async carryOverEngineSwitch(): Promise<number> {
    return 0;
  }

  async switchOnEngine(): Promise<boolean> {
    return true;
  }

  async pinEngineSwitch(): Promise<void> {}
}

function failingGate(): AuthzCutoverGateService {
  return AuthzCutoverGateService.create({
    repository: new FailingCutoverRepository(),
    logger: createTestLogger().logger,
  });
}

describe("AuthZ counters", () => {
  /** @scenario "The two AuthZ series are described once for every process" */
  it("records both series through the metrics facade, the cause as a label", async () => {
    await revocations().enforceGrantRevocation({
      organizationId: "organization-1",
      grantIds: ["grant-1"],
      reason: "revocation",
    });
    await failingGate().query({ organizationId: "organization-1" });

    expect(writesBy("revocation")).toBe(1);
    expect(gateReadFailures()).toBe(1);
  });

  /** @scenario "A second composition shares the series rather than refusing" */
  it("counts a second composition into the series the first one created", async () => {
    const before = gateReadFailures();

    await failingGate().query({ organizationId: "organization-1" });
    await failingGate().query({ organizationId: "organization-2" });

    expect(gateReadFailures()).toBe(before + 2);
  });

  /** @scenario "A queue-bypassing write is counted under its own cause" */
  it("counts a direct write under the cause that made it, not under the other one", async () => {
    const offboards = writesBy("offboard");
    const revoked = writesBy("revocation");

    await revocations().enforceGrantRevocation({
      organizationId: "organization-1",
      grantIds: ["grant-1", "grant-2", "grant-3"],
      reason: "offboard",
    });

    expect(writesBy("offboard")).toBe(offboards + 1);
    expect(writesBy("revocation")).toBe(revoked);
  });
});
