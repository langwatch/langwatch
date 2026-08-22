import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

import { uiCallCommand } from "../call";

describe("the ui call command", () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    process.env.LANGY_CONVERSATION_ID = "conv_test";
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.LANGY_CONVERSATION_ID;
    process.exitCode = undefined;
  });

  describe("given the page applies the action", () => {
    it("sends the dispatch with a deadline on it", async () => {
      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response('{"executedVia":"browser"}'),
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await uiCallCommand("workbench.getState", {});

      expect(result?.data).toEqual({ executedVia: "browser" });
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("given the platform never answers", () => {
    it("names the deadline and warns the action may have applied", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new DOMException("The operation was aborted", "TimeoutError");
        }),
      );

      const result = await uiCallCommand("workbench.setCellValue", {});

      expect(result).toBeUndefined();
      expect(process.exitCode).toBe(1);
      expect(stderr.join("")).toContain("did not answer");
      expect(stderr.join("")).toContain("may still have applied");
      expect(stderr.join("")).not.toContain("TimeoutError");
    });
  });

  describe("given the request fails for another reason", () => {
    it("lets the failure through unchanged", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed");
        }),
      );

      await expect(uiCallCommand("workbench.getState", {})).rejects.toThrow(
        "fetch failed",
      );
    });
  });
});
