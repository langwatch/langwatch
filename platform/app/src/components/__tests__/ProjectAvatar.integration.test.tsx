/**
 * @vitest-environment jsdom
 *
 * The project bubble with an emoji-named project.
 *
 * The unit coverage of `firstGrapheme` proves the character is taken whole;
 * this proves the bubble actually shows that character. It has to, because
 * the avatar library re-derives initials with `charAt(0)` whenever it is
 * handed a `name` — so a component that passes the correct initial through
 * the wrong prop breaks in exactly the same way, with every unit test green.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectAvatar } from "../ProjectAvatar";

afterEach(cleanup);

function renderAvatar(name: string) {
  const { container } = render(
    <ChakraProvider value={defaultSystem}>
      <ProjectAvatar name={name} />
    </ChakraProvider>,
  );
  return container;
}

describe("given a project whose name begins with an emoji", () => {
  /** @scenario "the bubble renders the emoji rather than a replacement box" */
  it("renders the whole emoji", () => {
    const container = renderAvatar("🏭 Background jobs");

    expect(screen.getByText("🏭")).toBeInTheDocument();
    expect(hasLoneSurrogate(container.textContent ?? "")).toBe(false);
  });

  it("keeps a multi-code-point emoji together", () => {
    renderAvatar("🇳🇱 Netherlands");

    expect(screen.getByText("🇳🇱")).toBeInTheDocument();
  });
});

describe("given a project named with plain letters", () => {
  /** @scenario "an ordinary name is unaffected" */
  it("renders the first letter, exactly as before", () => {
    renderAvatar("Engineering");

    expect(screen.getByText("E")).toBeInTheDocument();
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
