/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */
import "@testing-library/jest-dom/vitest";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BraidConditionField } from "../../blocks/braids/dialog/braid-condition-field.tsx";
import { BraidCondition } from "../braid-condition.tsx";

afterEach(cleanup);

const CONDITION = 'attributes["orchestrator"] == "web" and Verified("orchestrator")';

/** The coloured spans' text, so a test reads which parts were set apart. */
const spans = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("span")).map((span) => span.textContent);

describe("Feature: Braids screen", () => {
  /** @scenario A braid condition reads with syntax highlighting */
  it("colours a listed condition by part and keeps its whole text as the title", () => {
    renderWithDesignSystem(<BraidCondition where={CONDITION} />);
    const code = screen.getByTestId("braid-condition-code");
    expect(code).toHaveTextContent(CONDITION);
    expect(code).toHaveAttribute("title", CONDITION);
    expect(spans(code)).toEqual(
      expect.arrayContaining(["attributes", '"orchestrator"', "==", '"web"', "and", "Verified"]),
    );
  });

  /** @scenario A braid condition reads with syntax highlighting */
  it("colours the condition in the editor as it stands", () => {
    renderWithDesignSystem(
      <BraidConditionField
        value={CONDITION}
        onChange={() => undefined}
        check={compileBraidCondition({ text: CONDITION })}
        ownerName="specialists"
        readerName="orchestrator"
        verified
        attributeKeys={[]}
      />,
    );
    expect(screen.getByTestId("braid-condition")).toHaveValue(CONDITION);
    const layer = screen.getByTestId("expression-textarea-highlight");
    expect(spans(layer)).toEqual(expect.arrayContaining(["and", "Verified", '"web"']));
  });
});
