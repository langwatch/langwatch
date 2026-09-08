/**
 * Resolution against the operator store: the registry default when no row
 * exists, the row as a fleet-wide kill switch, per-project rules, and the
 * store read failing.
 */
import { describe, expect, it, vi } from "vitest";
import { createFeatureFlagTestService } from "../app/__tests__/feature-flag.fixture.ts";

const BLOB_OFFLOAD = "release_trace_blob_offload";
const MEDIA_EXTRACTION = "release_trace_media_extraction";
const PROJECT_ID = "project-abc";
const OPTED_OUT_PROJECT_ID = "project-opted-out";

function buildGraph() {
  return createFeatureFlagTestService({ now: () => 0 });
}

async function writeOptOutRule(service: ReturnType<typeof buildGraph>["service"]): Promise<void> {
  await service.setRules({
    key: BLOB_OFFLOAD,
    rules: [{ match: { projectId: OPTED_OUT_PROJECT_ID }, enabled: false }],
    lastEditedBy: "operator-1",
  });
}

describe("given no operator row exists for the trace blob offload flag", () => {
  describe("when the ingestion edge resolves the flag for a project", () => {
    /** @scenario "Oversized span content survives ingestion wherever storage is available" */
    it("resolves to the registry default of on", async () => {
      const { service } = buildGraph();

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given an operator switched the trace blob offload flag off fleet-wide", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("returns false, so the row keeps working as a kill switch over the default", async () => {
      const { service } = buildGraph();
      await service.setEnabled({
        key: BLOB_OFFLOAD,
        enabled: false,
        lastEditedBy: "operator-1",
      });

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an operator wrote a single per-project opt-out rule and no row existed before", () => {
  describe("when the ingestion edge resolves the flag for the targeted project", () => {
    /** @scenario "Oversized span content survives ingestion wherever storage is available" */
    it("returns false for that project", async () => {
      const { service } = buildGraph();
      await writeOptOutRule(service);

      await expect(
        service.isEnabled(BLOB_OFFLOAD, {
          kind: "project",
          projectId: OPTED_OUT_PROJECT_ID,
        }),
      ).resolves.toBe(false);
    });
  });

  describe("when the ingestion edge resolves the flag for a project the rule does not name", () => {
    /** @scenario "Oversized span content survives ingestion wherever storage is available" */
    it("stays enabled, so one project's opt-out never turns the fleet off", async () => {
      const { service } = buildGraph();
      await writeOptOutRule(service);

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });

    it("seeds the created row's fallback from the registry default rather than false", async () => {
      const { service, repository } = buildGraph();
      await writeOptOutRule(service);

      await expect(repository.findByKey(BLOB_OFFLOAD)).resolves.toMatchObject({ enabled: true });
    });
  });
});

describe("given a rule-only write for a flag whose registry default is off", () => {
  describe("when the ingestion edge resolves the flag for an unnamed project", () => {
    it("stays off, so an org-scoped enable cannot flip the flag on fleet-wide", async () => {
      const { service } = buildGraph();
      await service.setRules({
        key: MEDIA_EXTRACTION,
        rules: [{ match: { organizationId: "org-early-access" }, enabled: true }],
        lastEditedBy: "operator-1",
      });

      await expect(
        service.isEnabled(MEDIA_EXTRACTION, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(false);
    });
  });
});

describe("given the store read fails", () => {
  describe("when the ingestion edge resolves the flag", () => {
    /** @scenario "A database failure resolves the flag to its registry default" */
    it("falls back to the registry default rather than propagating the error", async () => {
      const { service, repository } = buildGraph();
      vi.spyOn(repository, "findByKey").mockRejectedValueOnce(new Error("connection terminated"));

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given an operator clears a flag", () => {
  describe("when the flag is resolved again", () => {
    it("returns to the registry default", async () => {
      const { service } = buildGraph();
      await service.setEnabled({
        key: BLOB_OFFLOAD,
        enabled: false,
        lastEditedBy: "operator-1",
      });
      await service.clearStoredFlag({ key: BLOB_OFFLOAD, lastEditedBy: "operator-1" });

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});
