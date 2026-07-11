import { beforeEach, describe, expect, it } from "vitest";
import {
  LangyCliEnvelopeService,
  type LangyToolFrame,
} from "../langy-cli-envelope.service";

const bashFrame = (overrides: Partial<LangyToolFrame>): LangyToolFrame => ({
  id: "call_1",
  name: "bash",
  phase: "start",
  ...overrides,
});

describe("LangyCliEnvelopeService", () => {
  let service: LangyCliEnvelopeService;

  beforeEach(() => {
    service = LangyCliEnvelopeService.create();
  });

  describe("given a bash frame running the LangWatch CLI", () => {
    it("re-types the start frame as the capability it invoked", () => {
      const frame = service.normalizeToolFrame({
        frame: bashFrame({
          input: { command: "langwatch trace search --format json" },
        }),
      });

      expect(frame.name).toBe("langwatch.trace.search");
      expect(frame.id).toBe("call_1");
      expect(frame.input).toEqual({
        command: "langwatch trace search --format json",
      });
    });

    it("re-types the end frame and reduces its output to the JSON document", () => {
      const stdout = [
        "⠋ Searching traces...",
        '{"traces":[{"trace_id":"trace_1"}],"pagination":{"totalHits":1}}',
        "Use langwatch trace get <traceId> to view full details",
      ].join("\n");

      const frame = service.normalizeToolFrame({
        frame: bashFrame({
          phase: "end",
          input: { command: "langwatch trace search -f json" },
          output: stdout,
        }),
      });

      expect(frame.name).toBe("langwatch.trace.search");
      expect(JSON.parse(frame.output!)).toEqual({
        traces: [{ trace_id: "trace_1" }],
        pagination: { totalHits: 1 },
      });
    });

    it("reads a command passed as a bare string input", () => {
      const frame = service.normalizeToolFrame({
        frame: bashFrame({ input: "langwatch dataset list --format json" }),
      });

      expect(frame.name).toBe("langwatch.dataset.list");
    });

    it("re-types the other shell-tool spellings too", () => {
      for (const name of ["shell", "execute", "Bash"]) {
        const frame = service.normalizeToolFrame({
          frame: bashFrame({ name, input: { command: "langwatch monitor list" } }),
        });
        expect(frame.name).toBe("langwatch.monitor.list");
      }
    });
  });

  describe("given a CLI frame whose output holds no JSON document", () => {
    it("keeps the raw output and still re-types the frame", () => {
      const frame = service.normalizeToolFrame({
        frame: bashFrame({
          phase: "end",
          input: { command: "langwatch trace search" },
          output: "Trace ID   Input\ntrace_1    hi",
        }),
      });

      expect(frame.name).toBe("langwatch.trace.search");
      expect(frame.output).toBe("Trace ID   Input\ntrace_1    hi");
    });
  });

  describe("given a CLI frame that errored", () => {
    it("keeps the error text the CLI printed", () => {
      const frame = service.normalizeToolFrame({
        frame: bashFrame({
          phase: "end",
          input: { command: "langwatch trace get missing" },
          output: "✖ Failed to fetch trace: not found",
          isError: true,
        }),
      });

      expect(frame.name).toBe("langwatch.trace.get");
      expect(frame.output).toBe("✖ Failed to fetch trace: not found");
      expect(frame.isError).toBe(true);
    });
  });

  describe("given a shell frame that is not a LangWatch CLI call", () => {
    it("passes a plain shell command through untouched", () => {
      const original = bashFrame({ input: { command: "pnpm test:unit" } });
      expect(service.normalizeToolFrame({ frame: original })).toBe(original);
    });

    it("passes a bash frame carrying no command through untouched", () => {
      const original = bashFrame({ input: { description: "run the tests" } });
      expect(service.normalizeToolFrame({ frame: original })).toBe(original);
    });
  });

  describe("given a frame from a tool that is not a shell", () => {
    it("passes a file-writing tool through even when its input mentions the CLI", () => {
      const original: LangyToolFrame = {
        id: "call_9",
        name: "write",
        phase: "start",
        input: { filePath: "run.sh", content: "langwatch trace search" },
      };
      expect(service.normalizeToolFrame({ frame: original })).toBe(original);
    });
  });
});
