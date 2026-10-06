/**
 * ADR-144 block D: the shared rules the aggregate kind is held to. Each is a
 * free function so the tRPC router, the REST app and the permission gate ask
 * the same question; these pin the answers.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { describe, expect, it, vi } from "vitest";
import { applyAggregateAdminGate } from "../../permissions/aggregate-admin-gate";
import {
  AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL,
  AGGREGATE_PROJECT_INGEST_REFUSAL,
  AGGREGATE_PROJECT_KIND,
  aggregateProjectRouteViolation,
  INTERNAL_GOVERNANCE_PROJECT_KIND,
  projectKindsHiddenFrom,
  traceDestinationViolation,
} from "../project-kinds";

describe("given the admin-only route rule", () => {
  describe("when an aggregate is opened", () => {
    it.each([
      "MEMBER",
      "DEVELOPER",
      "EXTERNAL",
      null,
      undefined,
    ])("refuses a caller whose organisation role is %s", (organizationRole) => {
      expect(
        aggregateProjectRouteViolation({
          kind: AGGREGATE_PROJECT_KIND,
          organizationRole,
        }),
      ).toBe(AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL);
    });

    it("lets an organisation admin in", () => {
      expect(
        aggregateProjectRouteViolation({
          kind: AGGREGATE_PROJECT_KIND,
          organizationRole: "ADMIN",
        }),
      ).toBeNull();
    });
  });

  describe("when any other kind is opened", () => {
    it("leaves the decision to the ordinary permission check", () => {
      expect(
        aggregateProjectRouteViolation({
          kind: "application",
          organizationRole: "MEMBER",
        }),
      ).toBeNull();
    });
  });
});

describe("given the project lists", () => {
  it("hide the governance project from everyone and the aggregate from non-admins", () => {
    expect(projectKindsHiddenFrom("ADMIN")).toEqual([
      INTERNAL_GOVERNANCE_PROJECT_KIND,
    ]);
    for (const role of ["MEMBER", "DEVELOPER", "EXTERNAL", null]) {
      expect(projectKindsHiddenFrom(role)).toEqual([
        INTERNAL_GOVERNANCE_PROJECT_KIND,
        AGGREGATE_PROJECT_KIND,
      ]);
    }
  });
});

describe("given a trace destination", () => {
  it("refuses the aggregate and nothing else", () => {
    expect(traceDestinationViolation(AGGREGATE_PROJECT_KIND)).toBe(
      AGGREGATE_PROJECT_INGEST_REFUSAL,
    );
    expect(traceDestinationViolation("application")).toBeNull();
    expect(traceDestinationViolation(null)).toBeNull();
  });
});

describe("given the permission gate on project decisions", () => {
  const kinds = { kindOf: vi.fn(async () => AGGREGATE_PROJECT_KIND) };

  describe("when the engine admitted a non-admin to an aggregate", () => {
    it("turns the decision into a refusal and keeps the role for the denial copy", async () => {
      const gated = await applyAggregateAdminGate({
        decision: { permitted: true, organizationRole: "DEVELOPER" as const },
        projectId: "project_aggregate",
        kinds,
      });

      expect(gated).toMatchObject({
        permitted: false,
        organizationRole: "DEVELOPER",
        denialReason: "no-binding",
      });
    });
  });

  describe("when the caller is an organisation admin, or was already refused", () => {
    it("passes the decision through without reading the project", async () => {
      kinds.kindOf.mockClear();
      const admitted = { permitted: true, organizationRole: "ADMIN" as const };
      const refused = { permitted: false, organizationRole: "MEMBER" as const };

      expect(
        await applyAggregateAdminGate({
          decision: admitted,
          projectId: "p",
          kinds,
        }),
      ).toBe(admitted);
      expect(
        await applyAggregateAdminGate({
          decision: refused,
          projectId: "p",
          kinds,
        }),
      ).toBe(refused);
      expect(kinds.kindOf).not.toHaveBeenCalled();
    });
  });
});
