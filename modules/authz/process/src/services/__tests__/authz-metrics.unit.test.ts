/**
 * Spec: modules/authz/specs/grants-command-dispatch.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { register } from "prom-client";
import { describe, expect, it } from "vitest";

import {
  type AuthzCutoverDatabase,
  PrismaAuthzCutoverRepository,
} from "../../repositories/prisma/prisma.authz-cutover.repository.ts";
import {
  type AuthzRevocationReason,
  authzDirectProjectionWriteTotal,
  PrismaAuthzRevocationRepository,
} from "../../repositories/prisma/prisma.authz-revocation.repository.ts";
import {
  AuthzCutoverGateService,
  authzEngineGateReadFailuresTotal,
} from "../authz-cutover-gate.service.ts";

async function writesBy(reason: AuthzRevocationReason): Promise<number> {
  const { values } = await authzDirectProjectionWriteTotal.get();
  return values.find((value) => value.labels.reason === reason)?.value ?? 0;
}

async function gateReadFailures(): Promise<number> {
  const { values } = await authzEngineGateReadFailuresTotal.get();
  return values[0]?.value ?? 0;
}

function revocations(): PrismaAuthzRevocationRepository {
  return PrismaAuthzRevocationRepository.create({
    database: { grant: { updateMany: async () => ({ count: 0 }) } },
  });
}

function failingGate(): AuthzCutoverGateService {
  const database: AuthzCutoverDatabase = {
    systemMigrationTenantState: {
      findUnique: async () => {
        throw new Error("pg is down");
      },
    },
  };
  return AuthzCutoverGateService.create({
    repository: PrismaAuthzCutoverRepository.create({ database }),
    logger: createTestLogger().logger,
  });
}

describe("AuthZ counters", () => {
  /** @scenario "The two AuthZ series are described once for every process" */
  it("renders both series into the process registry, the cause as a label", async () => {
    await revocations().enforceGrantRevocation({
      organizationId: "organization-1",
      grantIds: ["grant-1"],
      reason: "revocation",
    });
    await failingGate().query({ organizationId: "organization-1" });

    const scrape = await register.metrics();
    expect(scrape).toContain('langwatch_authz_direct_projection_write_total{reason="revocation"}');
    expect(scrape).toContain("authz_engine_gate_read_failures_total");
  });

  /** @scenario "A second composition shares the series rather than refusing" */
  it("counts a second composition into the series the first one created", async () => {
    const before = await gateReadFailures();

    await failingGate().query({ organizationId: "organization-1" });
    await failingGate().query({ organizationId: "organization-2" });

    expect(await gateReadFailures()).toBe(before + 2);
  });

  /** @scenario "A queue-bypassing write is counted under its own cause" */
  it("counts a direct write under the cause that made it, not under the other one", async () => {
    const offboards = await writesBy("offboard");
    const revoked = await writesBy("revocation");

    await revocations().enforceGrantRevocation({
      organizationId: "organization-1",
      grantIds: ["grant-1", "grant-2", "grant-3"],
      reason: "offboard",
    });

    expect(await writesBy("offboard")).toBe(offboards + 1);
    expect(await writesBy("revocation")).toBe(revoked);
  });
});
