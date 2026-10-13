/**
 * @vitest-environment node
 * A malformed OTLP logs body, through the door to the real receiver: 400, one warning.
 * @see specs/otlp/client-parse-failures.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { LogApi } from "@langwatch/log-contract";
import type * as Observability from "@langwatch/observability";
import type * as TestHarness from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import type * as LangWatch from "langwatch";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OtlpLogReceiverService } from "../../services/otlp-log-receiver.service.ts";
import { otlpLogsDoor, otlpLogsRest } from "../otlp-logs.rest.ts";

const receiverLog = vi.hoisted(() => ({
  loggerName: "langwatch:otel:v1:logs",
  lines: [] as { level?: number; msg?: string; [field: string]: unknown }[],
}));

const spanDouble = vi.hoisted(() => ({
  setStatus: vi.fn(),
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  recordException: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const original = await importOriginal<typeof Observability>();
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const receiver = harness.createTestLogger();
  receiverLog.lines = receiver.lines;

  return {
    ...original,
    createLogger: (name: string, options?: Parameters<typeof original.createLogger>[1]) =>
      name === receiverLog.loggerName ? receiver.logger : original.createLogger(name, options),
  };
});

// Only the ingest tracer is doubled, so the span the receiver writes can be read.
vi.mock("langwatch", async (importOriginal) => {
  const actual = await importOriginal<typeof LangWatch>();
  return {
    ...actual,
    getLangWatchTracer: (name: string) =>
      name === "langwatch.otel.logs"
        ? {
            withActiveSpan: (
              _name: string,
              _options: unknown,
              fn: (span: typeof spanDouble) => unknown,
            ) => fn(spanDouble),
          }
        : actual.getLangWatchTracer(name),
  };
});

const PINO_WARN = 40;
const PINO_ERROR = 50;

function mount() {
  const traces = createApiFixture<TraceApi>({
    otlpCredential: async () => ({
      project: { id: "project-123", teamId: "team-1", organizationId: "organization-1" },
      identity: {
        apiKeyId: "api-key-1",
        organizationId: "organization-1",
        ingestSourceType: null,
        ingestionTemplateId: null,
      },
    }),
    otlpUsageLimit: async () => {},
  });
  const receiver = OtlpLogReceiverService.create({
    traces,
    collection: createApiFixture(),
  });
  const app = createApiFixture<LogApi>({
    receiveOtlpLogs: (input) => receiver.receive(input),
  });
  const hono = createRestRuntime({
    doors: { otlp_ingest: otlpLogsDoor.open(traces) },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the receiver resolves its own credential");
      },
    },
  }).mount(otlpLogsRest.router(), {
    app: () => app,
    credential: "otlp_ingest",
    onError: (error) => {
      throw error;
    },
  });

  const postMalformed = () =>
    hono.request("/api/otel/v1/logs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": "sk-lw-test" },
      body: "{not json",
    });

  return { postMalformed };
}

const parseWarnings = () =>
  receiverLog.lines.filter((line) => line.level === PINO_WARN && line.msg === "error parsing logs");

describe("the OTLP logs receiver", () => {
  beforeEach(() => {
    receiverLog.lines.length = 0;
    vi.clearAllMocks();
  });

  describe("when a project sends a malformed body", () => {
    /** @scenario "A malformed logs body is treated as the client's error" */
    it("answers 400, warns once as the client's fault, logs no error and reports nothing", async () => {
      const { postMalformed } = mount();

      const response = await postMalformed();

      expect([response.status, await response.json()]).toEqual([
        400,
        { error: "Failed to parse logs" },
      ]);
      expect(parseWarnings()).toEqual([
        expect.objectContaining({ handledErrorFault: "customer", projectId: "project-123" }),
      ]);
      expect(receiverLog.lines.filter((line) => line.level === PINO_ERROR)).toEqual([]);
    });

    /** @scenario "A malformed body leaves the ingest span status unset and records the customer fault" */
    it("leaves the ingest span status unset and records the customer fault", async () => {
      const { postMalformed } = mount();

      await postMalformed();

      expect(spanDouble.setStatus).not.toHaveBeenCalled();
      expect(spanDouble.recordException).not.toHaveBeenCalled();
      expect(spanDouble.setAttributes).toHaveBeenCalledWith({
        "langwatch.error.fault": "customer",
        "langwatch.otel.parse_error": expect.any(String),
      });
    });
  });
});
