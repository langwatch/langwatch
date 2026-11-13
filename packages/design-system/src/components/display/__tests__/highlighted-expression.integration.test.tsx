/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { HighlightedExpression } from "../highlighted-expression.tsx";

afterEach(cleanup);

describe("Feature: Filter expressions read with syntax highlighting", () => {
  /** @scenario "A highlighted expression keeps its whole text" */
  it("Scenario: A highlighted expression keeps its whole text", () => {
    const code = 'name == "web" or attributes["k"] != nil';
    renderWithDesignSystem(<HighlightedExpression code={code} />);
    const element = screen.getByTitle(code);
    expect(element.tagName).toBe("CODE");
    expect(element.textContent).toBe(code);
    expect(screen.getByText("or").tagName).toBe("SPAN");
    expect(screen.getByText('"web"').tagName).toBe("SPAN");
  });

  /** @scenario "A block expression cut to its lines keeps its whole text in the title" */
  it("Scenario: A block expression cut to its lines keeps its whole text in the title", () => {
    const code = 'attributes["orchestrator"] == "web" and attributes["tier"] == "gold"';
    renderWithDesignSystem(<HighlightedExpression layout="block" maxLines={2} code={code} />);
    const element = screen.getByTitle(code);
    expect(element.tagName).toBe("CODE");
    expect(element.textContent).toBe(code);
  });
});
