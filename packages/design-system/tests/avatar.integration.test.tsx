/**
 * @vitest-environment jsdom
 * Verify initials computed by the unit tests actually reach the DOM.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Avatar, UserAvatar } from "../src/components/avatar.tsx";

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

function renderUserAvatar(props: { src?: string | null; name?: string | null }) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <UserAvatar {...props} />
    </ChakraProvider>,
  );
}

describe("UserAvatar", () => {
  describe("given a photo URL", () => {
    it("draws the photo as given", () => {
      renderUserAvatar({ name: "Ada Lovelace", src: "https://sso.example/photo.png" });

      expect(document.querySelector("img")?.getAttribute("src")).toBe(
        "https://sso.example/photo.png",
      );
    });

    it("falls back to the initials when the URL does not load", () => {
      renderUserAvatar({ name: "Ada Lovelace", src: "https://sso.example/broken.png" });
      const photo = document.querySelector("img");
      if (!photo) throw new Error("the photo did not render");
      fireEvent.error(photo);

      expect(document.querySelector("img")).toBeNull();
      expect(screen.getByText("AL")).toBeTruthy();
    });
  });

  describe("given no URL", () => {
    it("draws the initials", () => {
      renderUserAvatar({ name: "Ada Lovelace", src: null });

      expect(document.querySelector("img")).toBeNull();
      expect(screen.getByText("AL")).toBeTruthy();
    });
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
