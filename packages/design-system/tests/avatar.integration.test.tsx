/**
 * @vitest-environment jsdom
 *
 * The shared avatar as it renders.
 *
 * The initials rule has its own unit coverage; what this adds is that the
 * rule is what actually reaches the DOM. That is the half that broke before:
 * the component library re-derives initials from `name` whenever it is handed
 * one, so a correct helper whose result is passed through the wrong prop
 * changes nothing on screen.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar } from "../src/components/avatar";

afterEach(cleanup);

function renderAvatar(children: React.ReactNode) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <Avatar.Root>{children}</Avatar.Root>
    </ChakraProvider>,
  );
}

describe("given a name beginning with an emoji", () => {
  /** @scenario "The shared avatar renders the whole emoji" */
  it("renders the whole emoji in the fallback", () => {
    const { container } = renderAvatar(<Avatar.Fallback name="🚩 Langy" />);

    expect(screen.getByText("🚩L")).toBeTruthy();
    expect(hasLoneSurrogate(container.textContent ?? "")).toBe(false);
  });
});

describe("given an ordinary name", () => {
  it("renders the initials it always did", () => {
    renderAvatar(<Avatar.Fallback name="John Doe" />);

    expect(screen.getByText("JD")).toBeTruthy();
  });
});

describe("given content instead of a name", () => {
  /** @scenario "Explicit content is rendered as given" */
  it("renders it untouched, deriving nothing", () => {
    renderAvatar(<Avatar.Fallback>🏭</Avatar.Fallback>);

    expect(screen.getByText("🏭")).toBeTruthy();
  });
});

describe("given no name at all", () => {
  /** @scenario "A blank name has no initials" */
  it("falls through to the generic icon rather than an empty bubble", () => {
    const { container } = renderAvatar(<Avatar.Fallback name="   " />);

    expect(container.textContent).toBe("");
    // Chakra's fallback icon, which it renders only when it is given neither
    // children nor a name it can read.
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

/** True when any UTF-16 surrogate in the string is missing its partner. */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
