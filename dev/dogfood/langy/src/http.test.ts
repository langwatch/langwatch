import { afterEach, describe, expect, it, vi } from "vitest";

import { createLangWatchHttp } from "./http.ts";

describe("createLangWatchHttp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the request when it times out and keeps the original error as cause", async () => {
    const abort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", async () => {
      throw abort;
    });
    const http = createLangWatchHttp({
      config: { endpoint: "http://x", apiKey: "k", projectId: "p" },
    });

    const failure = await http
      .request({ method: "GET", path: "/api/prompts", timeoutMs: 50 })
      .catch((error: unknown) => error as Error);

    expect(failure.message).toBe("GET /api/prompts timed out after 50ms");
    expect(failure.cause).toBe(abort);
  });
});
