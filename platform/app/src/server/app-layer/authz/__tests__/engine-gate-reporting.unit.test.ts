/** @vitest-environment node */

/**
 * The reporter the server composition installs on the engine gate
 * (ADR-092 decision 4). The gate ships with a no-op so it stays importable
 * from the browser; this is the half that hands the observability back — a
 * failed migration-state read must land in the log stream AND on the counter
 * an alert can page on, or a reopened legacy-fallback window is silent.
 *
 * @see specs/rbac/unified-authorization-engine.feature
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  ENGINE_GATE_CACHE_TTL_MS,
  queryOrganizationOnAuthzEngine,
  setAuthzEngineGateFailureReporter,
} from "../engine-gate";
import { installAuthzEngineGateReporting } from "../engine-gate-reporting";
import { authzEngineGateReadFailuresTotal } from "../metrics";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

const ORG_ID = "org_reporting";

async function counterValue(): Promise<number> {
  const metric = await authzEngineGateReadFailuresTotal.get();
  return metric.values[0]?.value ?? 0;
}

describe("the installed engine-gate failure reporter", () => {
  afterEach(() => {
    setAuthzEngineGateFailureReporter(() => undefined);
    vi.clearAllMocks();
  });

  describe("when a migration-state read fails after installation", () => {
    /** @scenario "A failed migration-state read is reported" */
    it("logs the reopened window and increments the read-failure counter", async () => {
      installAuthzEngineGateReporting();
      const error = new Error("pg is down");
      const prisma = {
        systemMigrationTenantState: {
          findUnique: vi.fn().mockRejectedValue(error),
        },
      } as unknown as Pick<PrismaClient, "systemMigrationTenantState">;
      const before = await counterValue();

      await expect(
        queryOrganizationOnAuthzEngine({ organizationId: ORG_ID, prisma }),
      ).resolves.toBe(false);

      expect(warn).toHaveBeenCalledWith(
        { organizationId: ORG_ID, error, ttlMs: ENGINE_GATE_CACHE_TTL_MS },
        expect.any(String),
      );
      await expect(counterValue()).resolves.toBe(before + 1);
    });
  });
});
