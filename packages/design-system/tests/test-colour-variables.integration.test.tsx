// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { colorSystem } from "../src/color-mode/color-system.ts";
import { getRawColorValue, useColorRawValue } from "../src/color-mode/index.tsx";
import {
  installTestColourVariables,
  renderWithDesignSystem,
  type TestColourVariables,
} from "../src/testing/index.tsx";

let colours: TestColourVariables | undefined;

afterEach(() => {
  cleanup();
  colours?.dispose();
  colours = void 0;
  document.body.removeAttribute("style");
  document.documentElement.className = "";
});

function Reader({ token }: { token: string }) {
  return <output aria-label={token}>{useColorRawValue(token)}</output>;
}

function reading(token: string): string {
  return screen.getByLabelText(token).textContent ?? "";
}

function emittedLayeredCss(): string {
  return (
    Array.from(document.querySelectorAll("style"))
      .map((node) => node.textContent ?? "")
      .find((css) => css.startsWith("@layer tokens")) ?? ""
  );
}

describe("the provider's token variables under jsdom", () => {
  /** @scenario Test colours resolve the real system's semantic variables */
  it("emits the variable inside a cascade layer that the computed style does not see", () => {
    renderWithDesignSystem(<Reader token="gray.50" />);

    expect(emittedLayeredCss()).toContain("--chakra-colors-fg-subtle:");
    expect(getComputedStyle(document.body).getPropertyValue("--chakra-colors-fg-subtle")).toBe("");
  });

  /** @scenario Test colours resolve the real system's semantic variables */
  it("resolves the same variable once it is declared outside a layer", () => {
    const sheet = document.createElement("style");
    sheet.textContent = "body { --chakra-colors-fg-subtle: #123456; }";
    document.head.append(sheet);
    try {
      expect(getComputedStyle(document.body).getPropertyValue("--chakra-colors-fg-subtle")).toBe(
        "#123456",
      );
    } finally {
      sheet.remove();
    }
  });
});

describe("installTestColourVariables", () => {
  /** @scenario Test colours resolve the real system's semantic variables */
  it("resolves fg.subtle and orange.solid to literals that match the theme", () => {
    colours = installTestColourVariables();
    renderWithDesignSystem(
      <>
        <Reader token="fg.subtle" />
        <Reader token="orange.solid" />
      </>,
    );

    expect(reading("fg.subtle")).toBe(colorSystem.gray[500].value);
    expect(reading("orange.solid")).toBe("#ED8926");
    expect(reading("fg.subtle")).not.toContain("var(");
    expect(getRawColorValue("orange.solid")).toBe(colorSystem.orange[500].value);
  });

  /** @scenario Changing the test mode updates a mounted raw-colour reader */
  it("moves a mounted reader to dark and back without remounting it", async () => {
    colours = installTestColourVariables();
    renderWithDesignSystem(<Reader token="fg.subtle" />);
    const mounted = screen.getByLabelText("fg.subtle");
    expect(reading("fg.subtle")).toBe(colorSystem.gray[500].value);

    act(() => colours?.setMode("dark"));
    await waitFor(() => expect(reading("fg.subtle")).toBe(colorSystem.gray[400].value));
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");

    act(() => colours?.setMode("light"));
    await waitFor(() => expect(reading("fg.subtle")).toBe(colorSystem.gray[500].value));
    expect(screen.getByLabelText("fg.subtle")).toBe(mounted);
  });

  /** @scenario Disposing test colours restores the previous environment */
  it("restores the earlier value, priority and mode class, and tolerates a second dispose", () => {
    document.body.style.setProperty("--chakra-colors-fg-subtle", "#abcdef", "important");
    document.documentElement.classList.add("dark");

    const handle = installTestColourVariables({ mode: "light" });
    handle.setMode("dark");
    expect(document.body.style.getPropertyValue("--chakra-colors-fg-subtle")).not.toBe("#abcdef");
    handle.dispose();
    handle.dispose();

    expect(document.body.style.getPropertyValue("--chakra-colors-fg-subtle")).toBe("#abcdef");
    expect(document.body.style.getPropertyPriority("--chakra-colors-fg-subtle")).toBe("important");
    expect(document.body.style.getPropertyValue("--chakra-colors-orange-solid")).toBe("");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).not.toHaveClass("light");
    expect(() => handle.setMode("light")).toThrow("disposed");
  });

  /** @scenario Disposing test colours restores the previous environment */
  it("leaves the next test without the tokens when the helper is not installed", () => {
    expect(document.body.style.getPropertyValue("--chakra-colors-fg-subtle")).toBe("");
    expect(() => getRawColorValue("fg.subtle")).toThrow(
      "Colour variable --chakra-colors-fg-subtle is not defined",
    );
  });

  /** @scenario Missing colour variables still fail visibly */
  it("still throws the production errors for a missing variable and an unknown token", () => {
    colours = installTestColourVariables();
    document.body.style.removeProperty("--chakra-colors-fg-subtle");

    expect(() => getRawColorValue("fg.subtle")).toThrow(
      "Colour variable --chakra-colors-fg-subtle is not defined",
    );
    expect(() => getRawColorValue("not-a-colour")).toThrow(/"not-a-colour" is not a colour token/);
  });
});
