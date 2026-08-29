/**
 * Store-level resolution of a registered flag, with the database as the
 * only faked hop. The fake is a real table behind `findUnique` / `upsert`,
 * so an operator write and the read that follows it round-trip through the
 * repository, the row store and the service rather than through an
 * assertion on call arguments.
 *
 * The public service resolves through that repository path. An absent row
 * falls through to the registry default; callers do not reproduce that
 * nullable decision outside the service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresFeatureFlagAdapter } from "../postgres.feature-flag.adapter";
import type { FeatureFlagService } from "../../services/feature-flag.service";
import { resolveFeatureFlagConfig } from "@langwatch/feature-flag-contract";
import { MemoryFeatureFlagCache } from "../../testing";

type FakeRow = {
  key: string;
  enabled: boolean;
  rules: unknown;
  lastEditedBy: string | null;
  updatedAt: Date;
};

const BLOB_OFFLOAD = "release_trace_blob_offload";
const MEDIA_EXTRACTION = "release_trace_media_extraction";
const PROJECT_ID = "project-abc";
const OPTED_OUT_PROJECT_ID = "project-opted-out";

const table = new Map<string, FakeRow>();

const findUnique = vi.fn(
  async ({ where }: { where: { key: string } }) => table.get(where.key) ?? null,
);
const findMany = vi.fn(async () => [...table.values()]);
const upsert = vi.fn(
  async ({
    where,
    create,
    update,
  }: {
    where: { key: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const existing = table.get(where.key);
    const row = existing
      ? { ...existing, ...update }
      : ({ updatedAt: new Date(0), ...create } as FakeRow);
    table.set(where.key, row);
    return row;
  },
);
const deleteMany = vi.fn(async ({ where }: { where: { key: string } }) => {
  table.delete(where.key);
  return { count: 1 };
});

// No experiment ships yet, so the experiment delegate is never reached on
// these paths; it is present because the adapter takes one database.
const experimentDelegate = {
  findMany: vi.fn(async () => []),
  upsert: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({})),
};

function buildService(): FeatureFlagService {
  return PostgresFeatureFlagAdapter.create({
    database: {
      featureFlag: { findUnique, findMany, upsert, deleteMany },
      featureFlagExperimentSetting: experimentDelegate,
    },
    cache: new MemoryFeatureFlagCache(),
    config: resolveFeatureFlagConfig({}),
    now: () => 0,
  });
}

async function writeOptOutRule(service: FeatureFlagService): Promise<void> {
  await service.setRules({
    key: BLOB_OFFLOAD,
    rules: [{ match: { projectId: OPTED_OUT_PROJECT_ID }, enabled: false }],
    lastEditedBy: "operator-1",
  });
}

beforeEach(() => {
  table.clear();
  vi.clearAllMocks();
});

describe("given no operator row exists for the trace blob offload flag", () => {
  describe("when the ingestion edge resolves the flag for a project", () => {
    it("resolves to the registry default of on", async () => {
      const service = buildService();

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given an operator switched the trace blob offload flag off fleet-wide", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("returns false, so the row keeps working as a kill switch over the default", async () => {
      const service = buildService();
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
    it("returns false for that project", async () => {
      const service = buildService();
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
    it("stays enabled, so one project's opt-out never turns the fleet off", async () => {
      const service = buildService();
      await writeOptOutRule(service);

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });

    it("seeds the created row's fallback from the registry default rather than false", async () => {
      const service = buildService();
      await writeOptOutRule(service);

      expect(table.get(BLOB_OFFLOAD)?.enabled).toBe(true);
    });
  });
});

describe("given a rule-only write for a flag whose registry default is off", () => {
  describe("when the ingestion edge resolves the flag for an unnamed project", () => {
    it("stays off, so an org-scoped enable cannot flip the flag on fleet-wide", async () => {
      const service = buildService();
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

describe("given the database read fails", () => {
  describe("when the ingestion edge resolves the flag", () => {
    it("falls back to the registry default rather than propagating the error", async () => {
      findUnique.mockRejectedValueOnce(new Error("connection terminated"));
      const service = buildService();

      await expect(
        service.isEnabled(BLOB_OFFLOAD, { kind: "project", projectId: PROJECT_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given an operator clears a flag", () => {
  describe("when the flag is resolved again", () => {
    it("returns to the registry default", async () => {
      const service = buildService();
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
