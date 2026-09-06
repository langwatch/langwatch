/**
 * `run()` used to take the idempotency key positionally, which left no room
 * for the values a run supplies for the parameters its scenarios declare. It
 * takes an options object now and still accepts the old positional string, so
 * both call forms are exercised here against the bytes that leave the process.
 *
 * Spec: specs/scenarios/scenario-run-parameters.feature
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SuitesApiService } from "../suites-api.service";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const runResponse = (): Response =>
  new Response(
    JSON.stringify({
      scheduled: true,
      batchRunId: "batch_1",
      setId: "set_1",
      jobCount: 1,
      skippedArchived: { scenarios: [], targets: [] },
      items: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const sentBody = async (): Promise<Record<string, unknown>> => {
  const request = mockFetch.mock.calls[0]![0] as Request;
  return (await request.json()) as Record<string, unknown>;
};

describe("SuitesApiService.run()", () => {
  const previousApiKey = process.env.LANGWATCH_API_KEY;
  const previousEndpoint = process.env.LANGWATCH_ENDPOINT;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(runResponse());
    process.env.LANGWATCH_API_KEY = "sk-lw-test";
    process.env.LANGWATCH_ENDPOINT = "https://api.langwatch.test";
  });

  afterEach(() => {
    if (previousApiKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = previousApiKey;
    if (previousEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
    else process.env.LANGWATCH_ENDPOINT = previousEndpoint;
  });

  describe("when called with an options object", () => {
    it("sends the parameters and the idempotency key it was given", async () => {
      const service = new SuitesApiService();

      await service.run("suite_1", {
        idempotencyKey: "run-1",
        parameters: { account_tier: "gold", seats: 12, beta: true },
      });

      expect(await sentBody()).toEqual({
        idempotencyKey: "run-1",
        parameters: { account_tier: "gold", seats: 12, beta: true },
      });
      expect((mockFetch.mock.calls[0]![0] as Request).url).toBe(
        "https://api.langwatch.test/api/suites/suite_1/run",
      );
    });
  });

  describe("when called with the deprecated positional key", () => {
    it("still sends that key, and no parameters", async () => {
      const service = new SuitesApiService();

      await service.run("suite_1", "run-legacy");

      expect(await sentBody()).toEqual({ idempotencyKey: "run-legacy" });
    });
  });

  describe("when called with neither", () => {
    it("generates an idempotency key and leaves parameters off the wire", async () => {
      const service = new SuitesApiService();

      await service.run("suite_1");

      const body = await sentBody();
      expect(Object.keys(body)).toEqual(["idempotencyKey"]);
      expect(body.idempotencyKey).toEqual(expect.any(String));
    });
  });
});
