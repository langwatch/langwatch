/**
 * What a degraded route writes to the log. The collector ships `msg` and drops
 * the fields beside it, so the cause is in the message, built only from curated
 * fields. Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { HandledError } from "@langwatch/handled-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

const warnMock = vi.fn();
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: (...args: unknown[]) => warnMock(...args),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { TraceSearchRouterService } from "../trace-search-router.service.ts";
import { answering, deps, input } from "./trace-search-router.harness.ts";

/** A provider failure as the AI composer raises it, meta and all. */
class ProviderFailed extends HandledError {
  declare readonly code: "ai_query_provider_error";
  constructor() {
    super("ai_query_provider_error", "The model did not answer usably.", {
      fault: "provider",
      httpStatus: 502,
      meta: { model: "openai/gpt-5-mini", provider: "openai", httpStatus: 429 },
    });
  }
}

/**
 * The messages the router warned with, in order. Each test asserts its own
 * count, so a failure names the test the count belonged to.
 */
function warnedMessages(): string[] {
  return warnMock.mock.calls.map((call) => String(call[1]));
}

beforeEach(() => {
  warnMock.mockClear();
});

describe("given a route that degraded", () => {
  describe("when the failure is a handled error carrying meta", () => {
    /** @scenario "A judge question no model could write is judged as typed" */
    it("names the code, the model, the provider and the status in the message", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        buildQuestion: vi.fn(async () => {
          throw new ProviderFailed();
        }),
      });
      await TraceSearchRouterService.create(d).route(input({ text: "frustrated users" }));
      expect(warnedMessages()).toEqual([
        "Instant Eval question could not be written; judging the sentence as typed (ai_query_provider_error openai/gpt-5-mini openai HTTP 429)",
      ]);
    });

    it("carries nothing the provider itself wrote", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new ProviderFailed();
        }),
      });
      await TraceSearchRouterService.create(d).route(input());
      // The handled message is ours, but it is copy: the log reads the code
      // and the curated fields, never the sentence.
      expect(warnedMessages().join("\n")).not.toContain("did not answer usably");
    });
  });

  describe("when the failure is a plain error", () => {
    /** @scenario "A model failure is a phrase search, not an error" */
    it("names the error's type, since it has no curated fields", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new TypeError("fetch failed against https://api.example.com");
        }),
      });
      await TraceSearchRouterService.create(d).route(input());
      const messages = warnedMessages();
      expect(messages).toEqual([
        "Filter route could not be built; searching the phrase instead (TypeError)",
      ]);
      expect(messages.join("\n")).not.toContain("api.example.com");
    });
  });

  describe("when the deployment has no classifier and the model decides", () => {
    /** @scenario "A model failure is a phrase search, not an error" */
    it("names the cause on that path too", async () => {
      const d = deps({
        classifier: null,
        routeWithModel: vi.fn(async () => {
          throw new ProviderFailed();
        }),
      });
      await TraceSearchRouterService.create(d).route(input());
      expect(warnedMessages()).toEqual([
        "Model could not route the search; searching the phrase instead (ai_query_provider_error openai/gpt-5-mini openai HTTP 429)",
      ]);
    });
  });
});
