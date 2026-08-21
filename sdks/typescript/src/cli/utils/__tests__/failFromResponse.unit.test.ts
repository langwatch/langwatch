/**
 * What survives from a failed `Response` to the document an agent parses.
 *
 * The pattern this helper replaces kept the sentence and dropped the rest, so a
 * 403 arrived as `network_error`, `terminal: false`, plus "check your network
 * connection" — three claims that are all wrong about a permission refusal, and
 * the one an agent acts on is `terminal`.
 */
import type { Ora } from "ora";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failSpinnerFromResponse } from "../failFromResponse";

const spinner = () =>
  ({ fail: vi.fn(), succeed: vi.fn(), stop: vi.fn() }) as unknown as Ora;

const responseOf = (status: number, body: unknown, contentType = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });

const documentFrom = (log: ReturnType<typeof vi.spyOn>) =>
  JSON.parse(String(log.mock.calls[0]?.[0])) as {
    ok: false;
    error: {
      code: string;
      message: string;
      httpStatus: number;
      isHandled: boolean;
      terminal: boolean;
      suggestions?: string[];
    };
  };

describe("failSpinnerFromResponse", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    log.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a refusal the platform named", () => {
    it("keeps the code, the status and the platform's own tips", async () => {
      await failSpinnerFromResponse({
        spinner: spinner(),
        response: responseOf(403, {
          error: "api_key_permission_not_delegable",
          message:
            "Langy is never granted triggers:create, whatever key or role you use. Make this change in LangWatch yourself.",
          tips: [
            "A wider key or a higher role does not change this — make the change in LangWatch instead",
          ],
        }),
        action: "create trigger",
        format: "json",
      });

      const { error } = documentFrom(log);

      expect(error.code).toBe("api_key_permission_not_delegable");
      expect(error.httpStatus).toBe(403);
      expect(error.isHandled).toBe(true);
      expect(error.suggestions?.join(" ")).toContain("LangWatch");
    });

    it("reports it as terminal, so a reader does not retry it", async () => {
      await failSpinnerFromResponse({
        spinner: spinner(),
        response: responseOf(403, {
          error: "api_key_permission_denied",
          message: "API Key does not grant required permission: triggers:create",
        }),
        action: "create trigger",
        format: "json",
      });

      expect(documentFrom(log).error.terminal).toBe(true);
    });
  });

  describe("given a body the platform did not name", () => {
    /**
     * The fallback is the whole reason this is safe to drop in: a gateway's
     * HTML page or a bare 500 takes the same path it always did, sentence
     * included, and says the code is ours rather than the platform's.
     */
    it("keeps the sentence and does not invent a domain code", async () => {
      await failSpinnerFromResponse({
        spinner: spinner(),
        response: responseOf(
          502,
          "<html><body>Bad Gateway</body></html>",
          "text/html",
        ),
        action: "create trigger",
        format: "json",
      });

      const { error } = documentFrom(log);

      expect(error.isHandled).toBe(false);
      expect(error.message).toContain("Bad Gateway");
    });
  });
});
