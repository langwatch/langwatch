/**
 * @vitest-environment jsdom
 * Every story, in both colour modes, through the package's own provider.
 */
/// <reference types="vite/client" />
import { cleanup, render } from "@testing-library/react";
import { composeStories } from "@storybook/react-vite";
import type { ComponentType } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import previewAnnotations from "../.storybook/preview.tsx";

const stories = import.meta.glob("../src/**/*.stories.tsx", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (!window.ResizeObserver) {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

afterEach(() => cleanup());

function composedFor(mode: "light" | "dark"): Array<[string, ComponentType]> {
  return Object.entries(stories).flatMap(([file, module]) => {
    const composed = composeStories(
      module as never,
      {
        ...previewAnnotations,
        initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
      } as never,
    );
    return Object.entries(composed).map(([name, story]): [string, ComponentType] => [
      `${file.replace("../src/", "")} → ${name}`,
      story as unknown as ComponentType,
    ]);
  });
}

describe("every design system story", () => {
  describe("given the catalogue", () => {
    /** @scenario "Every story renders in light and dark" */
    it("finds stories to render", () => {
      expect(Object.keys(stories).length).toBeGreaterThan(0);
    });
  });

  describe("when rendered in the light colour mode", () => {
    /** @scenario "Every story renders in light and dark" */
    it.each(composedFor("light"))("renders %s", (_name, Story) => {
      expect(() => render(<Story />)).not.toThrow();
    });
  });

  describe("when rendered in the dark colour mode", () => {
    /** @scenario "Every story renders in light and dark" */
    it.each(composedFor("dark"))("renders %s", (_name, Story) => {
      expect(() => render(<Story />)).not.toThrow();
    });
  });
});
