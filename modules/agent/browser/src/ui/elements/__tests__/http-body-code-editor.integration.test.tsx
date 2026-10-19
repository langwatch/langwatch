/**
 * @vitest-environment jsdom
 * The request body template is template source, not JSON yet: the editor draws no error markers
 * over a placeholder such as {{messages}}.
 * Spec: modules/agent/specs/http-body-template-editor.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monaco = vi.hoisted(() => ({
  props: undefined as { language?: string; options?: Record<string, unknown> } | undefined,
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: { language?: string; options?: Record<string, unknown> }) => {
    monaco.props = props;
    return <div data-testid="monaco" />;
  },
}));

import { HttpBodyCodeEditor } from "../http-body-code-editor.tsx";

afterEach(() => cleanup());

describe("the HTTP agent body template editor", () => {
  /** @scenario "A body template with a placeholder shows no error squiggle" */
  it("keeps JSON colouring but draws no validation decorations", async () => {
    renderWithDesignSystem(
      <HttpBodyCodeEditor
        value='{"messages": {{messages}}}'
        onChange={() => undefined}
        language="json"
      />,
    );

    await waitFor(() => expect(monaco.props).toBeDefined());
    expect(monaco.props?.language).toBe("json");
    expect(monaco.props?.options?.renderValidationDecorations).toBe("off");
  });
});
