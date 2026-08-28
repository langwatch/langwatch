// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment jsdom
 */

/**
 * The payload the edit drawer sends, and specifically what it says about a
 * trace destination the admin never touched.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * `updateSource` re-validates any destination it is handed
 * (`ingestionSource.service.ts:529-539`): undefined leaves the stored value
 * alone, null stops routing, and a named project is checked against the same
 * live-project guard create uses. So echoing the stored id back on every save
 * is not harmless — once that project is archived, the guard rejects it and
 * the admin cannot rename the source, let alone fix the destination.
 *
 * Asserted against `buildEditSubmission` because that is the builder the
 * drawer actually calls. An earlier revision of this branch tested a second
 * builder holding its own copy of the same rule; when the rebase onto #7430
 * left the drawer using only this one, those tests would have kept passing
 * while proving nothing about what ships.
 *
 * ADR-088 v7, Decision 9.
 */
import { describe, expect, it } from "vitest";
import { buildEditSubmission } from "../inventory.enterprise";

/**
 * `databricks_genie` routes conversations and is NOT an editable pull source
 * (`EDITABLE_PULL_CONFIG_SOURCE_TYPES` holds only `anthropic_admin`), so the
 * builder skips `resolvePullConfig` and cannot return null for a reason that
 * has nothing to do with the destination.
 */
const base = {
  organizationId: "org_acme",
  source: {
    id: "src_1",
    sourceType: "databricks_genie",
    parserConfig: {},
  },
  name: "Genie fleet",
  description: "",
  parserConfig: {},
  ottlStatements: [],
  pullSchedule: "",
};

describe("given the edit drawer's update payload", () => {
  describe("when the admin never touched the destination", () => {
    it("omits it, so an untouched destination is never re-validated", () => {
      const input = buildEditSubmission({ ...base, destination: undefined });
      expect(input).not.toBeNull();
      expect("traceProjectId" in input!).toBe(false);
    });

    it("omits it even when the stored destination has been archived", () => {
      const input = buildEditSubmission({ ...base, destination: undefined });
      expect(input?.traceProjectId).toBeUndefined();
      expect(input?.name).toBe("Genie fleet");
    });
  });

  describe("when the admin picked a different destination", () => {
    it("carries the new one", () => {
      const input = buildEditSubmission({
        ...base,
        destination: "proj_support",
      });
      expect(input?.traceProjectId).toBe("proj_support");
    });
  });

  describe("when the admin cleared the destination", () => {
    it("carries an explicit null, which is what stops routing", () => {
      const input = buildEditSubmission({ ...base, destination: null });
      expect(input).not.toBeNull();
      expect("traceProjectId" in input!).toBe(true);
      expect(input?.traceProjectId).toBeNull();
    });
  });

  describe("when the source type routes nothing", () => {
    it("never sends a destination, whatever the drawer held", () => {
      const input = buildEditSubmission({
        ...base,
        source: { ...base.source, sourceType: "otel_generic" },
        destination: "proj_support",
      });
      expect(input?.traceProjectId).toBeUndefined();
    });
  });
});
