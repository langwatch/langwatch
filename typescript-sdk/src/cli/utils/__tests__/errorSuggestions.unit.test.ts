/**
 * The code-keyed fallback table: exact-code hits, clean misses, and the rule
 * that advice the platform sent always beats advice the CLI shipped with.
 */
import { describe, expect, it } from "vitest";
import type { CliDomainError } from "@langwatch/cli-cards/domain-error";
import {
  fallbackSuggestionsFor,
  withFallbackSuggestions,
} from "../errorSuggestions";

const domain = (overrides: Partial<CliDomainError> = {}): CliDomainError => ({
  code: "not_found",
  kind: "not_found",
  message: "Dataset not found: sales-q3",
  httpStatus: 404,
  meta: {},
  isDomain: true,
  ...overrides,
});

describe("fallbackSuggestionsFor", () => {
  it("covers the codes a CLI user hits most", () => {
    for (const code of [
      "missing_api_key",
      "unauthorized",
      "forbidden",
      "not_found",
      "project_not_found",
      "validation_error",
      "budget_exceeded",
      "rate_limited",
      "network_error",
      "internal_error",
    ]) {
      expect(fallbackSuggestionsFor(code)?.suggestions.length).toBeGreaterThan(0);
    }
  });

  it("answers undefined for a code it does not know — no invented advice", () => {
    expect(fallbackSuggestionsFor("langy_turn_in_progress")).toBeUndefined();
    expect(fallbackSuggestionsFor("")).toBeUndefined();
  });

  it("never prefix-matches a longer code into the wrong bucket", () => {
    expect(fallbackSuggestionsFor("dataset_not_found")).toBeUndefined();
  });
});

describe("withFallbackSuggestions", () => {
  it("fills suggestions and docUrl when the platform sent neither", () => {
    const enriched = withFallbackSuggestions(domain({ code: "missing_api_key", kind: "missing_api_key" }));

    expect(enriched.suggestions).toEqual(
      fallbackSuggestionsFor("missing_api_key")?.suggestions,
    );
    expect(enriched.docUrl).toBe("https://langwatch.ai/docs/integration/cli");
  });

  it("keeps the server-sent advice verbatim when present", () => {
    const enriched = withFallbackSuggestions(
      domain({
        suggestions: ["The server's own next step"],
        docUrl: "https://langwatch.ai/docs/server-page",
      }),
    );

    expect(enriched.suggestions).toEqual(["The server's own next step"]);
    expect(enriched.docUrl).toBe("https://langwatch.ai/docs/server-page");
  });

  it("fills only the field the platform did NOT send", () => {
    // Server sent suggestions but no docUrl → fallback fills docUrl only.
    const suggestionsOnly = withFallbackSuggestions(
      domain({
        code: "missing_api_key",
        kind: "missing_api_key",
        suggestions: ["The server's own next step"],
      }),
    );

    expect(suggestionsOnly.suggestions).toEqual(["The server's own next step"]);
    expect(suggestionsOnly.docUrl).toBe(
      "https://langwatch.ai/docs/integration/cli",
    );

    // Server sent docUrl but no suggestions → fallback fills suggestions only.
    const docUrlOnly = withFallbackSuggestions(
      domain({
        code: "missing_api_key",
        kind: "missing_api_key",
        docUrl: "https://langwatch.ai/docs/server-page",
      }),
    );

    expect(docUrlOnly.suggestions).toEqual(
      fallbackSuggestionsFor("missing_api_key")?.suggestions,
    );
    expect(docUrlOnly.docUrl).toBe("https://langwatch.ai/docs/server-page");
  });

  it("returns the error untouched when the table has nothing for the code", () => {
    const original = domain({ code: "some_unlisted_code", kind: "some_unlisted_code" });

    expect(withFallbackSuggestions(original)).toBe(original);
  });
});
