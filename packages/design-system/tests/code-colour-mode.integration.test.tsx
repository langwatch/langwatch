// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ColorModeProvider } from "../src/color-mode/index.tsx";
import { CodeTabs } from "../src/components/layout/code-tabs.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function renderTabs({ mode }: { mode: "light" | "dark" }) {
  renderWithDesignSystem(
    <ColorModeProvider forcedTheme={mode}>
      <CodeTabs
        label="Snippet language"
        value="ts"
        onValueChange={() => undefined}
        items={[{ value: "ts", label: "TypeScript", language: "typescript", code: "const a = 1;" }]}
      />
    </ColorModeProvider>,
  );
}

const keywordColour = () =>
  [...document.querySelectorAll<HTMLElement>("pre span[style]")].find(
    (span) => span.textContent === "const",
  )?.style.color;

describe("CodeTabs colour mode", () => {
  /** @scenario CodeTabs highlights in the page's colour mode, forced or not */
  it("highlights with github-dark when the mode is forced to dark", async () => {
    renderTabs({ mode: "dark" });
    await waitFor(() => expect(keywordColour()).toBeDefined());
    expect(keywordColour()).toBe("rgb(249, 117, 131)");
  });

  /** @scenario CodeTabs highlights in the page's colour mode, forced or not */
  it("highlights with github-light when the mode is forced to light", async () => {
    renderTabs({ mode: "light" });
    await waitFor(() => expect(keywordColour()).toBeDefined());
    expect(keywordColour()).toBe("rgb(215, 58, 73)");
  });
});
