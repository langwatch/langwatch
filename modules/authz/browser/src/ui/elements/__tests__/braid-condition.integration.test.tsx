/**
 * @vitest-environment jsdom
 * Spec: modules/authz/specs/braids-screen.feature
 */
import "@testing-library/jest-dom/vitest";
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BraidConditionField } from "../../blocks/braids/dialog/braid-condition-field.tsx";
import { monacoRecorded } from "../../sections/braids/__tests__/monaco-editor-fake.tsx";
import { BraidCondition } from "../braid-condition.tsx";

vi.mock(
  "@monaco-editor/react",
  () => import("../../sections/braids/__tests__/monaco-editor-fake.tsx"),
);

afterEach(cleanup);

const CONDITION = 'attributes["orchestrator"] == "web" and Verified("orchestrator")';

/** The coloured spans' text, so a test reads which parts were set apart. */
const spans = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("span")).map((span) => span.textContent);

describe("Feature: Braids screen", () => {
  /** @scenario A braid condition reads with syntax highlighting */
  it("colours a listed condition by part and keeps its whole text as the title", () => {
    const where = 'attributes["orchestrator"] == "web" and name == "charge"';
    renderWithDesignSystem(<BraidCondition where={where} />);
    const code = screen.getByTestId("braid-condition-code");
    expect(code).toHaveTextContent(where);
    expect(code).toHaveAttribute("title", where);
    expect(spans(code)).toEqual(
      expect.arrayContaining(["attributes", '"orchestrator"', "==", '"web"', "and"]),
    );
  });

  /** @scenario A braid condition reads with syntax highlighting */
  it("says Verified as a Signed badge beside the rest of the condition", () => {
    renderWithDesignSystem(<BraidCondition where={CONDITION} />);
    expect(screen.getByTestId("braid-condition-code")).toHaveTextContent(
      'attributes["orchestrator"] == "web"',
    );
    expect(screen.getByTestId("braid-condition-code")).not.toHaveTextContent("Verified");
    expect(screen.getByTestId("braid-condition-signed")).toHaveTextContent("Signed");
  });

  /** @scenario A braid condition reads with syntax highlighting */
  it("colours the condition in the editor with the design system's theme", async () => {
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
    expect(await screen.findByTestId("braid-condition")).toHaveValue(CONDITION);
    expect(monacoRecorded.themes).toContain("braid-condition-light");
  });
});
