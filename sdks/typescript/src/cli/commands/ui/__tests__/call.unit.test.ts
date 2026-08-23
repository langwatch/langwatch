import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

import { readCliErrorDocument } from "@langwatch/langy/cards/handled-error";
import { uiCallCommand } from "../call";

/**
 * The dispatch body is always a JSON string. Reading it back is how these tests
 * prove what the command sent, so a non-string body is a failure worth naming.
 */
const sentBody = (init?: RequestInit): { payload: unknown } => {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error(`expected a JSON string body, got ${typeof body}`);
  }
  return JSON.parse(body) as { payload: unknown };
};

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

      expect(sentBody(fetchMock.mock.calls[0]?.[1]).payload).toEqual(AWKWARD);
    });

    it("reads it from stdin when the file is a dash", async () => {
      // Only the async-iterator half of stdin is read, so an async generator
      // stands in for the whole stream.
      vi.spyOn(process, "stdin", "get").mockReturnValue(
        (async function* () {
          yield Buffer.from(JSON.stringify(AWKWARD));
        })() as unknown as typeof process.stdin,
      );

      const fetchMock = vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response('{"executedVia":"browser"}'),
      );
      vi.stubGlobal("fetch", fetchMock);

      await uiCallCommand("workbench.setTargetPrompt", { payloadFile: "-" });

      expect(sentBody(fetchMock.mock.calls[0]?.[1]).payload).toEqual(AWKWARD);
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

  /**
   * The failure used to be written to stderr as the platform's REST envelope,
   * which is not the document this CLI's readers parse. The panel's tool card
   * therefore fell back to printing the whole thing, so a customer watching
   * Langy work saw a wall of escaped JSON with the one useful sentence buried
   * in the middle of it.
   */
  describe("given the platform refuses the action", () => {
    /** @scenario "A refused action reaches the reader as a sentence, not the wire envelope" */
    it("reports it as the CLI's own failure document", async () => {
      const stdout: string[] = [];
      vi.spyOn(console, "log").mockImplementation((line: unknown) => {
        stdout.push(String(line));
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: {
                  type: "bad_request",
                  code: "langy_ui_payload_invalid",
                  message:
                    'The payload for "workbench.setTargetPrompt" does not match the action\'s schema.',
                  meta: { kind: "workbench.setTargetPrompt" },
                },
              }),
              { status: 400 },
            ),
        ),
      );

      await uiCallCommand("workbench.setTargetPrompt", {
        payload: "{}",
        format: "json",
      });

      expect(process.exitCode).toBe(1);
      const document = readCliErrorDocument(stdout.join("\n"));
      expect(document).toMatchObject({
        code: "langy_ui_payload_invalid",
        message:
          'The payload for "workbench.setTargetPrompt" does not match the action\'s schema.',
      });
    });
  });
});
