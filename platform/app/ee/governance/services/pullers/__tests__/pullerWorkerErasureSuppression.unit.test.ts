// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a pull does with an event naming somebody who has been erased
 * (ADR-128 §9 step 1).
 *
 * The pull writes to three places, and the export to a customer's own trace
 * project is the one that leaves our storage entirely: the conversation goes
 * out carrying the provider's user id, the question and the answer. A
 * suppression check that covers the audit row and the cost record but not that
 * export re-publishes the erased person's conversation on every daily pull,
 * with the thirty-day lookback guaranteeing it happens again tomorrow.
 *
 * Same mocking boundary as pullerWorkerPulledUsage.unit.test.ts.
 *
 * Spec: specs/governance/governance-identity-and-erasure.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUnique,
  projectFindFirst,
  suppressionFindMany,
  insertEvent,
  handleOtlpTraceRequest,
  runOnce,
  isEnabled,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  projectFindFirst: vi.fn(),
  suppressionFindMany: vi.fn(),
  insertEvent: vi.fn(),
  handleOtlpTraceRequest: vi.fn(),
  runOnce: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...a: unknown[]) => isEnabled(...a) },
}));
vi.mock("~/server/db", () => ({
  prisma: {
    ingestionSource: { findUnique: (...a: unknown[]) => findUnique(...a) },
    project: { findFirst: (...a: unknown[]) => projectFindFirst(...a) },
    erasedIdentifierSuppression: {
      findMany: (...a: unknown[]) => suppressionFindMany(...a),
    },
  },
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    governance: {
      ocsfEvents: { insertEvent: (...a: unknown[]) => insertEvent(...a) },
    },
    traces: {
      collection: {
        handleOtlpTraceRequest: (...a: unknown[]) =>
          handleOtlpTraceRequest(...a),
      },
    },
  }),
}));
vi.mock("../../governanceOcsfEvents.clickhouse.repository", () => ({
  OCSF_ACTIVITY: { INVOKE: 1 },
  OCSF_SEVERITY: { INFO: 1 },
}));
vi.mock("../../governanceProject.service", () => ({
  ensureHiddenGovernanceProject: async () => ({ id: "proj_governance" }),
}));
vi.mock("../../activity-monitor/ingestionCredentials", () => ({
  decryptCredentials: () => ({ token: "sk-admin" }),
}));
vi.mock("../index", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    registerBuiltInPullers: () => undefined,
    pullerAdapterRegistry: {
      get: () => ({
        id: "test_adapter",
        validateConfig: (c: unknown) => c,
        runOnce: (...a: unknown[]) => runOnce(...a),
      }),
    },
  };
});

import { ERASURE_SECRET_ENV, erasureDigest } from "../../logic/erasureDigest";
import { runIngestionPull } from "../pullerWorker";

const SECRET = "a".repeat(32);
const ERASED = "leaver@acme.example";
const STAYS = "analyst@acme.example";

/** A Genie source, because that is a source type that routes conversations. */
const SOURCE_ROW = {
  id: "src_1",
  organizationId: "org_acme",
  teamId: "team_platform",
  sourceType: "databricks_genie",
  status: "active",
  traceProjectId: "proj_dest",
  parserConfig: { adapter: "test_adapter" },
} as const;

function genieEvent(actor: string, id: string) {
  return {
    source_event_id: id,
    event_timestamp: "2026-08-20T10:00:00.000Z",
    actor,
    action: "genie_query",
    target: "Sales space",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify({
      message_id: id,
      conversation_id: `conv-${id}`,
      content: `Question from ${actor}`,
      status: "COMPLETED",
      created_timestamp: 1755684000,
      attachments: [{ text: { content: "EMEA.", purpose: "ANSWER" } }],
    }),
    extra: { conversationId: `conv-${id}`, messageId: id },
  };
}

beforeEach(() => {
  vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
  findUnique.mockReset().mockResolvedValue(SOURCE_ROW);
  projectFindFirst.mockReset().mockResolvedValue({ id: "proj_dest" });
  insertEvent.mockReset().mockResolvedValue(undefined);
  handleOtlpTraceRequest.mockReset().mockResolvedValue({});
  runOnce.mockReset();
  // Off, so the run is the audit row plus the conversation export and nothing
  // has to stand in for the money pipeline.
  isEnabled.mockReset().mockResolvedValue(false);
  suppressionFindMany.mockReset().mockResolvedValue([]);
});

/** Everything the trace export was handed, flattened to one searchable string. */
function exportedPayload(): string {
  return JSON.stringify(handleOtlpTraceRequest.mock.calls);
}

describe("given a pull carrying an event that names an erased person", () => {
  beforeEach(() => {
    suppressionFindMany.mockResolvedValue([
      {
        organizationId: "org_acme",
        provider: "databricks_genie",
        identifierHash: erasureDigest({ secret: SECRET, identifier: ERASED }),
      },
    ]);
    runOnce.mockResolvedValue({
      events: [genieEvent(ERASED, "msg-erased")],
      cursor: null,
      errorCount: 0,
    });
  });

  describe("when the run reaches the customer's trace project", () => {
    /** @scenario "An erased person's conversations stop being exported" */
    it("exports nothing, rather than republishing the conversation", async () => {
      await runIngestionPull({ sourceId: "src_1", cursor: null });

      expect(handleOtlpTraceRequest).not.toHaveBeenCalled();
    });
  });

  describe("when the batch also carries somebody who was not erased", () => {
    /** @scenario "Suppression removes only the erased person from the export" */
    it("exports the other conversation and leaves the erased address out of it", async () => {
      runOnce.mockResolvedValue({
        events: [
          genieEvent(ERASED, "msg-erased"),
          genieEvent(STAYS, "msg-stays"),
        ],
        cursor: null,
        errorCount: 0,
      });

      await runIngestionPull({ sourceId: "src_1", cursor: null });

      expect(handleOtlpTraceRequest).toHaveBeenCalledTimes(1);
      expect(exportedPayload()).toContain(STAYS);
      expect(exportedPayload()).not.toContain(ERASED);
    });
  });
});

describe("given a pull where nobody has been erased", () => {
  describe("when the run reaches the customer's trace project", () => {
    it("exports the conversation exactly as it did before erasure existed", async () => {
      runOnce.mockResolvedValue({
        events: [genieEvent(STAYS, "msg-stays")],
        cursor: null,
        errorCount: 0,
      });

      await runIngestionPull({ sourceId: "src_1", cursor: null });

      expect(handleOtlpTraceRequest).toHaveBeenCalledTimes(1);
      expect(exportedPayload()).toContain(STAYS);
    });
  });
});
