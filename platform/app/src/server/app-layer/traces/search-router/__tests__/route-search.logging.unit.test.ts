/**
 * What a degraded route writes to the log.
 *
 * The collector that carries these lines ships `msg` and drops the structured
 * fields beside it, so the cause has to be inside the message or the operator
 * reads "something failed". Everything composed into it is already curated
 * for a customer-facing disclosure, so none of the provider's own prose
 * travels with it.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
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

import { createSearchRouter } from "../route-search";
import { answering, deps, input } from "./harness";

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

/** The message of the one warning the router wrote. */
function warnedMessage(): string {
  expect(warnMock).toHaveBeenCalledTimes(1);
  const [, message] = warnMock.mock.calls[0] as [unknown, string];
  return message;
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
      await createSearchRouter(d).route(input({ text: "frustrated users" }));
      expect(warnedMessage()).toBe(
        "Instant Eval question could not be written; judging the sentence as typed (ai_query_provider_error openai/gpt-5-mini openai HTTP 429)",
      );
    });

    it("carries nothing the provider itself wrote", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new ProviderFailed();
        }),
      });
      await createSearchRouter(d).route(input());
      // The handled message is ours, but it is copy: the log reads the code
      // and the curated fields, never the sentence.
      expect(warnedMessage()).not.toContain("did not answer usably");
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
      await createSearchRouter(d).route(input());
      const message = warnedMessage();
      expect(message).toBe(
        "Filter route could not be built; searching the phrase instead (TypeError)",
      );
      expect(message).not.toContain("api.example.com");
    });
  });
});
