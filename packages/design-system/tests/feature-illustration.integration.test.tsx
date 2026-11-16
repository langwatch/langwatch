// @vitest-environment jsdom
// Spec: packages/design-system/specs/feature-illustration.feature

import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FeatureIllustration } from "../src/components/brand/feature-illustration.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

function answerMotionPreference({ reduce }: { reduce: boolean }) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion") && !query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const animated = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-strand], [data-span]")].filter(
    (element) => getComputedStyle(element).animation !== "",
  );

describe("FeatureIllustration", () => {
  describe("given a reader who has not asked for less motion", () => {
    /** @scenario The empty state and the Enterprise art never animate */
    it("holds the empty state and the Enterprise art still", () => {
      answerMotionPreference({ reduce: false });
      const { container } = renderWithDesignSystem(
        <>
          <FeatureIllustration feature="braids" name="empty-state" />
          <FeatureIllustration feature="braids" name="enterprise" />
        </>,
      );
      expect(animated(container)).toEqual([]);
    });
  });

  describe("given any Braids illustration", () => {
    /** @scenario Illustrations are hidden from assistive technology */
    it.each(["empty-state", "enterprise"] as const)("hides %s", (name) => {
      const { container } = renderWithDesignSystem(
        <FeatureIllustration feature="braids" name={name} />,
      );
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("given two Braids empty state illustrations on the same page", () => {
    /** @scenario Two illustrations on one page never share a mask */
    it("gives every mask its own id", () => {
      const { container } = renderWithDesignSystem(
        <>
          <FeatureIllustration feature="braids" name="empty-state" />
          <FeatureIllustration feature="braids" name="empty-state" />
        </>,
      );
      const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
      expect(ids.length).toBe(6);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("given the Braids Enterprise illustration forced to dark mode", () => {
    /** @scenario Illustrations follow a forced colour mode */
    it("carries the dark colour-mode class", () => {
      const { container } = renderWithDesignSystem(
        <FeatureIllustration feature="braids" name="enterprise" forceColorMode="dark" />,
      );
      expect(container.querySelector("svg")?.classList.contains("dark")).toBe(true);
    });
  });
});
