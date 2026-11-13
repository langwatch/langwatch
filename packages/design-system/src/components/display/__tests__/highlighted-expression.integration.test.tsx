/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { ExpressionTextarea } from "../../forms/expression-textarea.tsx";
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

  /** @scenario "The expression editor highlights what is typed and underlines a marked span" */
  it("Scenario: The expression editor highlights what is typed and underlines a marked span", () => {
    const value = 'attributes["k"] >= 3';
    renderWithDesignSystem(
      <ExpressionTextarea
        aria-label="Expression"
        value={value}
        onChange={() => undefined}
        mark={{ at: 16, end: 18 }}
      />,
    );
    expect(screen.getByLabelText("Expression")).toHaveValue(value);
    const layer = screen.getByTestId("expression-textarea-highlight");
    expect(layer).toHaveAttribute("aria-hidden");
    expect(layer.textContent).toBe(`${value}\u200b`);
    const marked = Array.from(layer.querySelectorAll("span")).find(
      (span) => span.textContent === ">=",
    );
    expect(marked).toBeDefined();
    expect(getComputedStyle(marked!).textDecoration).toContain("wavy");
  });
});
