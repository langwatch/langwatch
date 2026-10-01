/**
 * @vitest-environment jsdom
 * @see specs/model-providers/no-models-empty-state.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NoModelsConfiguredCallout } from "../src/components/no-models-configured-callout.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("NoModelsConfiguredCallout", () => {
  it("renders the whole row as a link to settings, in a new tab", () => {
    renderWithDesignSystem(<NoModelsConfiguredCallout />);

    const callout = screen.getByTestId("no-models-configured-callout");
    expect(callout.tagName).toBe("A");
    expect(callout.getAttribute("href")).toBe("/settings/model-providers");
    expect(callout.getAttribute("target")).toBe("_blank");
    expect(callout.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByText(/No models configured/i)).not.toBeNull();
    expect(screen.queryByTestId("no-models-configured-cta")).not.toBeNull();
  });

  it("includes the surface-specific label when forFeatureLabel is provided", () => {
    renderWithDesignSystem(<NoModelsConfiguredCallout forFeatureLabel="evaluators" />);

    expect(screen.queryByText(/No models configured for evaluators/i)).not.toBeNull();
  });
});
