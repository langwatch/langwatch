import { describe, expect, it, vi } from "vitest";

import type { LangwatchApiClient } from "@/internal/api/client";

import { InstantEvalsApiError, InstantEvalsApiService } from "../instant-evals-api.service";

const serviceWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): InstantEvalsApiService =>
  new InstantEvalsApiService({
    langwatchApiClient: {
      GET: vi.fn(async () => result),
      POST: vi.fn(async () => result),
    } as unknown as LangwatchApiClient,
  });

/** What openapi-fetch hands back for a 502 whose body is empty. */
const emptyBadGateway = () => ({
  data: undefined,
  error: "",
  response: new Response(null, { status: 502 }),
});

describe("InstantEvalsApiService", () => {
  describe("given a proxy answers 502 with an empty body", () => {
    describe.each([
      ["get", (service: InstantEvalsApiService) => service.get("run-1")],
      ["list", (service: InstantEvalsApiService) => service.list()],
      ["cancel", (service: InstantEvalsApiService) => service.cancel("run-1")],
      ["results", (service: InstantEvalsApiService) => service.results("run-1")],
      ["sample", (service: InstantEvalsApiService) => service.sample("run-1")],
    ])("when %s is called", (_name, call) => {
      /** @scenario "A failed response with no body is reported as a failed request" */
      it("raises an API error carrying the 502 status", async () => {
        const failure = await call(serviceWith(emptyBadGateway())).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(InstantEvalsApiError);
        expect((failure as InstantEvalsApiError).status).toBe(502);
        expect((failure as InstantEvalsApiError).message).toContain("502");
      });
    });
  });

  describe("given the platform answers a run", () => {
    describe("when get is called", () => {
      it("returns the run", async () => {
        const run = { id: "run-1", status: "finished" };
        const service = serviceWith({
          data: run,
          response: new Response(null, { status: 200 }),
        });
        await expect(service.get("run-1")).resolves.toEqual(run);
      });
    });
  });
});
