/**
 * The Ask AI chip keeps a readable label when the shader cannot paint (no GPU).
 * @vitest-environment jsdom
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@paper-design/shaders-react", () => ({ MeshGradient: () => null }));

import { AskAiButton } from "../ask-ai-button.tsx";

const ruleFor = ({ className }: { className: string }) =>
  [...document.querySelectorAll("style")]
    .flatMap((style) => (style.textContent ?? "").split("}"))
    .filter((rule) => rule.trimStart().startsWith(`.${className}{`))
    .join("}");

describe("<AskAiButton/> without a GPU", () => {
  afterEach(cleanup);

  it("keeps a solid design-system background behind the contrast label", () => {
    renderWithDesignSystem(<AskAiButton onClick={vi.fn()} />);
    const chip = screen.getByRole("button", { name: "Enter AI mode" });
    const css = ruleFor({ className: chip.className.split(" ").pop()! });

    expect(css).toContain("color:var(--chakra-colors-purple-contrast)");
    expect(css).toContain("background:var(--chakra-colors-purple-solid)");
    expect(css).not.toContain("background:transparent");
  });
});
