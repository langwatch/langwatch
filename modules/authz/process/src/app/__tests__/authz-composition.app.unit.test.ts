import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
/**
 * AuthzModule.create composes the whole feature from the registry's rows, with
 * no member and no store client: what the old hand-built graph returned.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTHZ_GRANT_PIPELINE_NAME } from "../../eventing/authz-grant.pipeline.ts";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration.ts";
import type { AuthzAuditRow } from "../../repositories/authz-audit-trail.repository.ts";
import { authzDirectProjectionWriteTotal } from "../../repositories/authz-revocation.repository.ts";
import type { AuthzRepositories } from "../../repositories/authz.repositories.ts";
import { MemoryAuthzRepositories } from "../../repositories/memory/memory.authz.repositories.ts";
import { authzEngineGateReadFailuresTotal } from "../../services/authz-cutover-gate.service.ts";
import { AuthzModule, type AuthzSetup } from "../authz.app.ts";

const CONFIG = {
  epochCacheEnabled: false,
  demoProjectId: undefined,
  demoProjectUserId: undefined,
  demoProjectSlug: undefined,
};

function compose(repositories: AuthzRepositories = MemoryAuthzRepositories.create()) {
  return AuthzModule.create({
    dependencies: {},
    config: CONFIG,
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: createApiFixture<AuthzSetup["secrets"]>(),
    repositories,
  });
}

describe("AuthzModule.create", () => {
  /** @scenario "A process with no metric registry composes AuthZ" */
  it("builds the complete feature without dispatching or writing an audit row", () => {
    const memory = MemoryAuthzRepositories.create();
    const audited: AuthzAuditRow[] = [];
    const app = compose({
      ...memory,
      auditTrail: { insert: async (row: AuthzAuditRow) => void audited.push(row) },
    });

    const pipeline = app.eventingPipeline();
    expect(pipeline.metadata.name).toBe(AUTHZ_GRANT_PIPELINE_NAME);
    expect([...pipeline.mapProjections.keys()]).toEqual(["authzGrantsWrite"]);
    expect([...pipeline.eventSubscribers.keys()]).toEqual(["auditTrail"]);
    expect([...pipeline.mapSubscribers.keys()]).toEqual(["sessionVersion"]);
    expect(app.engineMigration().name).toBe(AUTHZ_ENGINE_MIGRATION_NAME);
    expect(audited).toEqual([]);
  });

  describe("when a process composes AuthZ", () => {
    const meter = createRecordingMeterProvider();
    beforeEach(() => meter.install());
    afterEach(() => meter.uninstall());

    /** @scenario "AuthZ counts on the process registry" */
    it("counts both of its series through the metrics facade", () => {
      compose();
      authzEngineGateReadFailuresTotal.inc();
      authzDirectProjectionWriteTotal.inc({ reason: "revocation" });

      expect(meter.valueOf("authz_engine_gate_read_failures_total")).toBe(1);
      expect(
        meter.valueOf("langwatch_authz_direct_projection_write_total", { reason: "revocation" }),
      ).toBe(1);
    });
  });
});
