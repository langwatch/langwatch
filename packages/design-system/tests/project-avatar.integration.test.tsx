/**
 * @vitest-environment jsdom
 *
 * Avatar bubble with emoji project names: full grapheme, not char(0) only.
 * Spec: specs/navigation/project-avatar-initial.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectAvatar } from "../src/components/display/project-avatar.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

function renderAvatar(name: string) {
  const { container } = renderWithDesignSystem(<ProjectAvatar name={name} />);
  return container;
}

describe("given a project whose name begins with an emoji", () => {
  /** @scenario "the bubble renders the emoji rather than a replacement box" */
  it("renders the whole emoji", () => {
    const container = renderAvatar("🏭 Background jobs");

    expect(screen.getByText("🏭")).toBeTruthy();
    expect(hasLoneSurrogate(container.textContent ?? "")).toBe(false);
  });

  it("keeps a multi-code-point emoji together", () => {
    renderAvatar("🇳🇱 Netherlands");

    expect(screen.getByText("🇳🇱")).toBeTruthy();
  });
});

describe("given a project named with plain letters", () => {
  /** @scenario "an ordinary name is unaffected" */
  it("renders the first letter, exactly as before", () => {
    renderAvatar("Engineering");

    expect(screen.getByText("E")).toBeTruthy();
  });
});

/** True when any UTF-16 surrogate in the string is missing its partner. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (isLow) return true;
  }
  return false;
}
