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

  /**
   * The payload that broke this in practice is a prompt draft. Prose has
   * apostrophes, and one apostrophe ends the shell's single-quoted argument, so
   * the rest of the prompt arrived as extra arguments and the edit was lost.
   */
  describe("given a payload too awkward to quote on a command line", () => {
    const AWKWARD = {
      targetId: "target-1",
      localPromptConfig: {
        messages: [
          {
            role: "system",
            content: "Don't invent policy.\nSay \"I don't know\" instead.",
          },
        ],
      },
    };

    /** @scenario "A payload too awkward to quote is read from a file or from stdin" */
    it("reads it from a file", async () => {
      const { mkdtemp, writeFile } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = await mkdtemp(join(tmpdir(), "ui-call-"));
      const file = join(dir, "payload.json");
      await writeFile(file, JSON.stringify(AWKWARD), "utf8");

      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response('{"executedVia":"browser"}'),
      );
      vi.stubGlobal("fetch", fetchMock);

      await uiCallCommand("workbench.setTargetPrompt", { payloadFile: file });

      const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(sent.payload).toEqual(AWKWARD);
    });

    it("reads it from stdin when the file is a dash", async () => {
      vi.spyOn(process, "stdin", "get").mockReturnValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (async function* () {
          yield Buffer.from(JSON.stringify(AWKWARD));
        })() as any,
      );

      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response('{"executedVia":"browser"}'),
      );
      vi.stubGlobal("fetch", fetchMock);

      await uiCallCommand("workbench.setTargetPrompt", { payloadFile: "-" });

      const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(sent.payload).toEqual(AWKWARD);
    });

    /** @scenario "Naming both a payload and a payload file is refused" */
    it("refuses when both an inline payload and a file are named", async () => {
      const fetchMock = vi.fn(async () => new Response("{}"));
      vi.stubGlobal("fetch", fetchMock);

      await uiCallCommand("workbench.setTargetPrompt", {
        payload: "{}",
        payloadFile: "somewhere.json",
      });

      expect(process.exitCode).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(stderr.join("")).toContain("--payload-file");
    });
  });
});
