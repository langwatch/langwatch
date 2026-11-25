/**
 * @vitest-environment jsdom
 * The Foundry JSON editor keeps its scope headers out of the way of the first scrolled line.
 * Spec: specs/ops/foundry-trace-playground.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const monaco = vi.hoisted(() => ({ options: undefined as Record<string, unknown> | undefined }));

vi.mock("@monaco-editor/react", () => ({
  default: (props: { options?: Record<string, unknown> }) => {
    monaco.options = props.options;
    return <div data-testid="monaco" />;
  },
}));

import { JsonView } from "../ui/sections/json-view.tsx";

afterEach(() => cleanup());

describe("the Foundry JSON editor", () => {
  /** @scenario "The JSON editor shows no pinned scope rows over the first scrolled line" */
  it("turns Monaco's sticky scope headers off", async () => {
    renderWithDesignSystem(<JsonView />);

    await waitFor(() => expect(monaco.options).toBeDefined());
    expect(monaco.options?.stickyScroll).toEqual({ enabled: false });
  });
});
