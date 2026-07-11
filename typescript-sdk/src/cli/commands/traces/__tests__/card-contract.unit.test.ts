/**
 * The CLI's `--format json` output IS the Langy panel's input. This pins the two
 * together: the document the command actually prints is parsed with the very
 * schema the app parses it with (`@langwatch/cli-cards`), so a change to either
 * side that breaks the other fails here rather than in the panel.
 *
 * This is the only place the CLI imports the card schemas — they cost ~28ms of
 * zod to load and no command needs them at runtime, so they stay out of the hot
 * path and earn their keep as a contract test instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cardKindFor,
  parseCliResult,
  tracesCardSchema,
  traceIdOf,
  type TraceSummary,
} from "@langwatch/cli-cards";

vi.mock("@/client-sdk/services/traces/traces-api.service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, TracesApiService: vi.fn() };
});

vi.mock("../../../utils/apiKey", () => ({ checkApiKey: vi.fn() }));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { searchTracesCommand } from "../search";

/** The shape the traces API really answers with — see openapiLangWatch.json. */
const API_RESPONSE = {
  traces: [
    {
      trace_id: "trace_abc",
      input: { value: "what is langwatch?" },
      output: { value: "an llm ops platform" },
      timestamps: { started_at: 1_770_000_000_000 },
    },
    {
      trace_id: "trace_def",
      input: { value: "how do i trace?" },
      output: { value: "install the sdk" },
      timestamps: { started_at: 1_770_000_001_000 },
    },
  ],
  pagination: { totalHits: 1204 },
};

describe("the CLI's json output against the shared card contract", () => {
  let printed: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    printed = [];
    vi.mocked(TracesApiService).mockImplementation(function () {
      return {
        search: vi.fn().mockResolvedValue(API_RESPONSE),
        get: vi.fn(),
      } as unknown as TracesApiService;
    });
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
  });

  describe("given a trace search that matched traces", () => {
    describe("when it prints its json document", () => {
      it("prints a document the traces card can read", async () => {
        await searchTracesCommand({ format: "json" });

        const document: unknown = JSON.parse(printed.join("\n"));
        const card = tracesCardSchema.safeParse(document);

        expect(card.success).toBe(true);
        expect(card.data?.pagination?.totalHits).toBe(1204);
        expect(
          card.data?.traces.map((trace: TraceSummary) => traceIdOf(trace)),
        ).toEqual(["trace_abc", "trace_def"]);
      });

      it("normalises the trace envelope so a card never has to unwrap it", async () => {
        await searchTracesCommand({ format: "json" });

        const document: unknown = JSON.parse(printed.join("\n"));
        const card = tracesCardSchema.parse(document);

        // The API sends `{ value: "…" }`; the card gets the bare string.
        expect(card.traces[0]?.input).toBe("what is langwatch?");
        expect(card.traces[0]?.output).toBe("an llm ops platform");
      });

      it("resolves to the traces card by the same name the panel resolves", async () => {
        await searchTracesCommand({ format: "json" });

        const document: unknown = JSON.parse(printed.join("\n"));
        const result = parseCliResult({
          resource: "trace",
          verb: "search",
          output: document,
        });

        expect(cardKindFor({ resource: "trace", verb: "search" })).toBe("traces");
        expect(result).toMatchObject({ ok: true, kind: "traces" });
      });
    });
  });

  describe("given the panel receives the output as the string the envelope recorded", () => {
    describe("when it reads the result", () => {
      it("reads the same card out of the string", async () => {
        await searchTracesCommand({ format: "json" });

        // The tool envelope hands the panel a STRING, not an object.
        const asString = printed.join("\n");
        const result = parseCliResult({
          resource: "trace",
          verb: "search",
          output: asString,
        });

        expect(result.ok).toBe(true);
      });
    });
  });

  describe("given a result that is not the shape its card expects", () => {
    describe("when it is read", () => {
      it("degrades to no card rather than to a wrong one", () => {
        const result = parseCliResult({
          resource: "trace",
          verb: "search",
          output: { traces: "not an array" },
        });

        expect(result.ok).toBe(false);
      });

      it("degrades to no card when the output is a human table", () => {
        const result = parseCliResult({
          resource: "trace",
          verb: "search",
          output: "Trace ID   Input   Output\n───────────────────────",
        });

        expect(result).toMatchObject({ ok: false });
      });
    });
  });
});
