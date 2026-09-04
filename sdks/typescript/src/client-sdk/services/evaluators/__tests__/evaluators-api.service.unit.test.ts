import { describe, expect, it, vi } from "vitest";
import { EvaluatorsApiService } from "../evaluators-api.service";
import { EvaluatorsApiError } from "../errors";
import type { CreateEvaluatorBody } from "../types";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * D12: openapi-fetch's own empty-body short-circuit answers a non-2xx (or an
 * empty-but-ok) response with neither `data` nor a parsed `error` when the
 * body is unreadable — a proxy's empty 502 page, a truncated response. Left
 * unguarded, `if (error) …; return data;` resolves the promise with
 * `undefined`, and the caller fails three lines later with something like
 * "Cannot read properties of undefined" instead of at the call site.
 *
 * `specs/typescript-sdk/non-json-platform-errors.feature` names the contract
 * this binds: an unreadable body still raises the same typed API error a
 * named failure would, carrying the operation and the HTTP status.
 */
const clientWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): LangwatchApiClient =>
  ({
    GET: vi.fn(async () => result),
    POST: vi.fn(async () => result),
    PATCH: vi.fn(async () => result),
    PUT: vi.fn(async () => result),
    DELETE: vi.fn(async () => result),
  }) as unknown as LangwatchApiClient;

const serviceWith = (result: { data?: unknown; error?: unknown; response?: Response }) =>
  new EvaluatorsApiService({ langwatchApiClient: clientWith(result) });

describe("given an EvaluatorsApiService whose transport answers an unreadable body", () => {
  describe("when the platform answers a 502 with no data and no parsed error", () => {
    /** @scenario "A 502 with an unreadable body rejects with the typed API error naming the operation and the status" */
    it("rejects with the typed API error naming the operation and the status", async () => {
      const service = serviceWith({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 502 }),
      });

      await expect(service.getAll()).rejects.toBeInstanceOf(EvaluatorsApiError);
      await expect(service.getAll()).rejects.toMatchObject({
        operation: "fetch all evaluators",
      });
      await expect(service.getAll()).rejects.toThrow(/502/);
    });
  });

  describe("when the platform answers 200 with an empty body on a method that promises data", () => {
    /** @scenario "A 200 with an empty body on a method that promises data rejects rather than resolving undefined" */
    it("rejects with the typed API error instead of resolving undefined", async () => {
      const service = serviceWith({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 200 }),
      });

      const params = { name: "eval", config: {} } as CreateEvaluatorBody;

      await expect(service.create(params)).rejects.toBeInstanceOf(EvaluatorsApiError);
      await expect(service.create(params)).rejects.toMatchObject({
        operation: "create evaluator",
      });
    });
  });
});
