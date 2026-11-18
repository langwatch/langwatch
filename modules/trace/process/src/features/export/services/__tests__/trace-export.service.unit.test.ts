import type { Protections, TracesForProjectResult, ExportRequest } from "@langwatch/trace-contract";
/** AC1 export wiring: proves TraceService is used and both modes resolve
 * blobs to prevent truncation data loss. */
import { beforeEach, describe, expect, it } from "vitest";

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceLegacyReadService } from "../../../legacy/services/trace-legacy-read.service.ts";
import { TraceExportService } from "../trace-export.service.ts";
import {
  hiddenOriginsOnly,
  legacyReadAnswering,
  renderedFilter,
} from "./support/trace-legacy-read.support.ts";

/** The options the export hands the legacy read, its own-read proof included. */
type SeenOptions = Parameters<TraceLegacyReadService["getAllTracesForProject"]>[2];

const authorization = ownProof({ projectId: "proj-1" });
const protections: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

function buildExportRequest(overrides?: Partial<ExportRequest>): ExportRequest {
  return {
    projectId: "proj-1",
    mode: "summary",
    format: "csv",
    filters: {},
    startDate: 1_700_000_000_000,
    endDate: 1_700_000_100_000,
    ...overrides,
  };
}

/**
 * A TraceService stub whose getAllTracesForProject records the options it was
 * called with, then returns a single-batch result so the export loop terminates.
 */
function buildOptionsCapturingTraceService(): {
  traceService: TraceLegacyReadService;
  optionsSeen: SeenOptions[];
} {
  const optionsSeen: SeenOptions[] = [];
  const traceService = legacyReadAnswering(
    async (
      _input: unknown,
      _protections: unknown,
      options: SeenOptions,
    ): Promise<TracesForProjectResult> => {
      optionsSeen.push(options);
      // A complete-enough Trace so the real CSV/JSON serializers run.
      const trace = {
        trace_id: "t1",
        project_id: "proj-1",
        metadata: {},
        timestamps: {
          started_at: 1_700_000_000_000,
          inserted_at: 1_700_000_001_000,
          updated_at: 1_700_000_002_000,
        },
        input: { value: "hello" },
        output: { value: "world" },
        spans: [],
        evaluations: [],
      };
      return {
        groups: [[trace as never]],
        totalHits: 1,
        traceChecks: {},
        scrollId: undefined,
      } as TracesForProjectResult;
    },
  );
  return { traceService, optionsSeen };
}

async function drainExport(service: TraceExportService, request: ExportRequest) {
  for await (const _chunk of service.exportTraces({ request, protections, authorization })) {
    // consume the generator
  }
}

describe("TraceExportService hides what the Explorer hides", () => {
  /** @scenario "Langy's own turns are left out of every Analytics read" */
  it("excludes the langy origin from the count and from every batch", async () => {
    const seen: SeenOptions[] = [];
    const built = buildOptionsCapturingTraceService();
    const service = TraceExportService.create({
      authorizeOwnRead: async () => authorization,
      compileFilter: hiddenOriginsOnly,
      traceService: built.traceService,
    });

    await service.getTotalCount({ request: buildExportRequest(), protections, authorization });
    await drainExport(service, buildExportRequest());
    seen.push(...built.optionsSeen);

    expect(seen).toHaveLength(2);
    for (const options of seen) {
      const statement = renderedFilter({ compile: options.compileFilter, tenantId: "proj-1" });
      expect(statement?.sql).toMatch(/NOT \(.* IN \(\{(\w+):Array\(String\)\}\)\)/);
      expect(Object.values(statement?.params ?? {})).toContainEqual(["langy"]);
      // The repository compiles the filter for the scope of this proof.
      expect(options.ownRead).toBe(authorization);
    }
  });

  /** @scenario "Langy's own turns are left out of every Analytics read" */
  it("applies the compiled Explorer filter and sends no free-text query", async () => {
    const inputs: unknown[] = [];
    const traceService = legacyReadAnswering(async (input: unknown) => {
      inputs.push(input);
      return { groups: [], totalHits: 0, traceChecks: {}, scrollId: undefined } as never;
    });
    const service = TraceExportService.create({
      authorizeOwnRead: async () => authorization,
      traceService,
      compileFilter: hiddenOriginsOnly,
    });

    await service.getTotalCount({
      request: buildExportRequest({ query: "status:error" }),
      protections,
      authorization,
    });

    expect(inputs[0]).not.toHaveProperty("query", "status:error");
  });

  it("keeps them when the query names an origin itself", async () => {
    const built = buildOptionsCapturingTraceService();
    const service = TraceExportService.create({
      authorizeOwnRead: async () => authorization,
      compileFilter: hiddenOriginsOnly,
      traceService: built.traceService,
    });

    await drainExport(service, buildExportRequest({ query: "origin:langy" }));

    expect(built.optionsSeen[0]?.compileFilter).toBeUndefined();
  });
});

describe("TraceExportService hides what the over-plan state withholds", () => {
  /** @scenario "A trace list answers only the count of traces recorded after the cutoff" */
  it("ends the count and every batch just before the cutoff", async () => {
    const inputs: { endDate?: number }[] = [];
    const traceService = legacyReadAnswering(async (input: unknown) => {
      inputs.push(input as { endDate?: number });
      return { groups: [], totalHits: 1, traceChecks: {}, scrollId: undefined } as never;
    });
    const service = TraceExportService.create({
      authorizeOwnRead: async () => authorization,
      traceService,
      compileFilter: hiddenOriginsOnly,
    });
    const cutoff = 1_700_000_050_000;
    const withheld = { ...protections, withheldFromMs: cutoff } as Protections;
    const request = buildExportRequest();

    await service.getTotalCount({ request, protections: withheld, authorization });
    for await (const _chunk of service.exportTraces({
      request,
      protections: withheld,
      authorization,
    })) {
      // consume the generator
    }

    expect(inputs.map((input) => input.endDate)).toEqual([cutoff - 1, cutoff - 1]);
  });
});

describe("TraceExportService — #4991 AC1 full export resolution", () => {
  describe("when TraceExportService.create() receives the process-owned reader", () => {
    it("wraps that reader without constructing another service", async () => {
      const { traceService, optionsSeen } = buildOptionsCapturingTraceService();
      const service = TraceExportService.create({
        authorizeOwnRead: async () => authorization,
        compileFilter: hiddenOriginsOnly,
        traceService,
      });

      await drainExport(service, buildExportRequest({ mode: "summary" }));

      expect(optionsSeen).toHaveLength(1);
    });
  });

  describe("given a FULL export (mode: full, includes spans)", () => {
    describe("when exportTraces streams a batch", () => {
      it("opts resolveBlobs into the getAllTracesForProject options", async () => {
        const { traceService, optionsSeen } = buildOptionsCapturingTraceService();
        const service = TraceExportService.create({
          authorizeOwnRead: async () => authorization,
          compileFilter: hiddenOriginsOnly,
          traceService,
        });

        await drainExport(service, buildExportRequest({ mode: "full" }));

        expect(optionsSeen.length).toBeGreaterThan(0);
        expect(optionsSeen.every((o) => o.resolveBlobs === true)).toBe(true);
        expect(optionsSeen.every((o) => o.includeSpans === true)).toBe(true);
      });
    });
  });

  // A SUMMARY export reads no span content but still emits trace-level
  // input/output, so gating resolution on includeSpans silently shipped the
  // truncated 64 KB preview for any offloaded trace — the bug this PR fixes.
  describe("given a SUMMARY export (reads trace-level input/output)", () => {
    describe("when exportTraces streams a batch", () => {
      let optionsSeen: SeenOptions[];

      beforeEach(async () => {
        const built = buildOptionsCapturingTraceService();
        optionsSeen = built.optionsSeen;
        const service = TraceExportService.create({
          authorizeOwnRead: async () => authorization,
          compileFilter: hiddenOriginsOnly,
          traceService: built.traceService,
        });
        await drainExport(service, buildExportRequest({ mode: "summary" }));
      });

      it("opts resolveBlobs in so an offloaded trace is not truncated to its preview", async () => {
        expect(optionsSeen.length).toBeGreaterThan(0);
        expect(optionsSeen.every((o) => o.resolveBlobs === true)).toBe(true);
      });

      it("reads no span content (includeSpans stays false)", async () => {
        expect(optionsSeen.every((o) => o.includeSpans === false)).toBe(true);
      });
    });
  });

  // Grounds WHY the assertion above must hold: prove the summary payload really
  // does carry the trace-level IO value. If a future change stopped emitting
  // input/output in summary rows, resolving blobs there would become dead cost
  // and this test would tell us so.
  describe("given a SUMMARY csv export of a trace with trace-level IO", () => {
    describe("when the export is drained", () => {
      it("emits the trace input/output value into the payload", async () => {
        const { traceService } = buildOptionsCapturingTraceService();
        const service = TraceExportService.create({
          authorizeOwnRead: async () => authorization,
          compileFilter: hiddenOriginsOnly,
          traceService,
        });

        let payload = "";
        for await (const { chunk } of service.exportTraces({
          request: buildExportRequest({ mode: "summary", format: "csv" }),
          protections,
          authorization,
        })) {
          payload += chunk;
        }

        // The stub trace carries input "hello" / output "world".
        expect(payload).toContain("hello");
        expect(payload).toContain("world");
      });
    });
  });
});
