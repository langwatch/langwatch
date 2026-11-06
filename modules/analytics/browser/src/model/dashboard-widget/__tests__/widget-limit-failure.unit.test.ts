/**
 * The editor preview prints a limit failure as the reason, then the registry's remedy.
 * @see modules/analytics/specs/analytics-widget-editor.feature
 */

import type { ChartQueryError } from "@langwatch/analytics-contract/chart-frame-protocol";
import { describe, expect, it } from "vitest";

import { editorLimitError, isWidgetLimitFailure } from "../widget-limit-failure.ts";

describe("editorLimitError", () => {
  /** @scenario "A limit failure in the preview names the reason and the remedy" */
  it("prints the memory limit's reason, then the remedy", () => {
    const error: ChartQueryError = {
      code: "query_memory_exceeded",
      title: "This search was too large",
      message: "Narrow the time range, add a filter, or select fewer fields.",
    };
    expect(editorLimitError(error)).toEqual({
      code: "query_memory_exceeded",
      title: "Couldn't load",
      message:
        "The query used more memory than a widget may use. " +
        "Narrow the time range, add a filter, or select fewer fields.",
    });
  });

  /** @scenario "A limit failure in the preview names the reason and the remedy" */
  it("prints the time limit's reason, then the remedy", () => {
    const error: ChartQueryError = {
      code: "query_timeout",
      title: "This search took too long",
      message: "Narrow the time range or add a filter, then try again.",
    };
    expect(editorLimitError(error)).toEqual({
      code: "query_timeout",
      title: "Couldn't load",
      message:
        "The query ran past the time a widget may take. " +
        "Narrow the time range or add a filter, then try again.",
    });
  });

  /** @scenario "A limit failure in the preview names the reason and the remedy" */
  it("leaves any other failure unchanged", () => {
    const error: ChartQueryError = {
      code: "lwql_not_permitted",
      title: "Not permitted",
      message: "You may not see this.",
    };
    expect(editorLimitError(error)).toBe(error);
  });
});

describe("isWidgetLimitFailure", () => {
  it("is false for names an object inherits", () => {
    expect(isWidgetLimitFailure("constructor")).toBe(false);
    expect(isWidgetLimitFailure("toString")).toBe(false);
    expect(isWidgetLimitFailure("query_timeout")).toBe(true);
  });
});
