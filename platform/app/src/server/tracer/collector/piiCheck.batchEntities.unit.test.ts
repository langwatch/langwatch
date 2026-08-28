import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { errorStatusInc } = vi.hoisted(() => ({ errorStatusInc: vi.fn() }));

vi.mock("~/server/metrics", () => ({
  getPiiChecksCounter: () => ({ inc: () => undefined }),
  getEvaluationStatusCounter: (_name: string, status: string) => ({
    inc: status === "error" ? errorStatusInc : () => undefined,
  }),
  evaluationDurationHistogram: { labels: () => ({ observe: () => undefined }) },
}));

import { AppPiiRedactionTransport } from "./piiCheck";
import { resolveTracePrivacyRuntimeConfig } from "~/runtime/trace-privacy.config";

const transport = AppPiiRedactionTransport.create(
  resolveTracePrivacyRuntimeConfig({ langevalsEndpoint: "http://test-langevals" }),
);

describe("batchPresidioClearPII", () => {
  let capturedBody: { settings: { entities: Record<string, boolean> } };

  beforeEach(() => {
    errorStatusInc.mockReset();
    vi.spyOn(global, "fetch").mockImplementation(async (_url: unknown, init: unknown) => {
      const body = (init as { body: string }).body;
      capturedBody = JSON.parse(body);
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => [{ status: "processed", raw_response: { anonymized: "scrubbed" } }],
      } as unknown as Response;
    });
  });

  it("records an error metric when Presidio rejects the request", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "unavailable",
    } as Response);

    await expect(transport.clearPresidio(["any text"], "STRICT")).rejects.toThrow("unavailable");
    expect(errorStatusInc).toHaveBeenCalledOnce();
  });

  it("aborts fetch at the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const config = resolveTracePrivacyRuntimeConfig({
        langevalsEndpoint: "http://test-langevals",
      });
      const timeoutTransport = AppPiiRedactionTransport.create({
        ...config,
        presidio: { ...config.presidio, timeoutMs: 25 },
      });
      let requestSignal: AbortSignal | undefined;
      vi.spyOn(global, "fetch").mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );

      const request = timeoutTransport.clearPresidio(["any text"], "STRICT");
      const requestFailure = request.then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(25);

      expect(requestSignal?.aborted).toBe(true);
      await expect(requestFailure).resolves.toMatchObject({ message: "aborted" });
    } finally {
      vi.useRealTimers();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("given a custom entity selection narrower than the level default", () => {
    describe("when the level is STRICT but only PERSON is requested", () => {
      it("sends only the selected entity to the analysis service", async () => {
        await transport.clearPresidio(["any text"], "STRICT", ["PERSON"]);

        expect(capturedBody.settings.entities).toEqual({ person: true });
      });
    });
  });

  describe("given no custom entities", () => {
    describe("when the level is ESSENTIAL", () => {
      it("sends the full essential entity list and excludes strict-only ones", async () => {
        await transport.clearPresidio(["any text"], "ESSENTIAL");

        expect(capturedBody.settings.entities.credit_card).toBe(true);
        expect(capturedBody.settings.entities.email_address).toBe(true);
        expect(capturedBody.settings.entities.person).toBeUndefined();
      });
    });
  });
});
