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
    /** @scenario The hero weaves in once when motion is allowed */
    it("animates each strand once, staggered", () => {
      answerMotionPreference({ reduce: false });
      const { container } = renderWithDesignSystem(
        <FeatureIllustration feature="braids" name="hero" />,
      );
      expect(container.querySelector("svg")?.getAttribute("data-motion")).toBe("play");
      const strands = [...container.querySelectorAll("[data-strand]")];
      expect(strands).toHaveLength(3);
      for (const strand of strands) {
        expect(getComputedStyle(strand).animation).toContain("feature-weave-in");
        expect(getComputedStyle(strand).animation).not.toContain("infinite");
      }
      const delays = strands.map((strand) => (strand as SVGElement).style.animationDelay);
      expect(new Set(delays).size).toBe(3);
    });

    /** @scenario The empty state and the Enterprise art never animate */
    it("holds the empty state and the Enterprise art still", () => {
      answerMotionPreference({ reduce: false });
      const { container } = renderWithDesignSystem(
        <>
          <FeatureIllustration feature="braids" name="empty-state" />
          <FeatureIllustration feature="braids" name="enterprise" />
        </>,
      );
      for (const svg of container.querySelectorAll("svg[data-illustration]")) {
        expect(svg.getAttribute("data-motion")).toBe("still");
      }
      expect(animated(container)).toEqual([]);
    });
  });

  describe("given a reader who has asked their system for less motion", () => {
    /** @scenario The hero stands still for a reader who asked for less motion */
    it("animates nothing", () => {
      answerMotionPreference({ reduce: true });
      const { container } = renderWithDesignSystem(
        <FeatureIllustration feature="braids" name="hero" />,
      );
      expect(container.querySelector("svg")?.getAttribute("data-motion")).toBe("still");
      expect(animated(container)).toEqual([]);
    });
  });

  describe("given any Braids illustration", () => {
    /** @scenario Illustrations are hidden from assistive technology */
    it.each(["empty-state", "enterprise", "hero"] as const)("hides %s", (name) => {
      const { container } = renderWithDesignSystem(
        <FeatureIllustration feature="braids" name={name} />,
      );
      expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    });
  });

  describe("given two Braids hero illustrations on the same page", () => {
    /** @scenario Two illustrations on one page never share a mask */
    it("gives every mask its own id", () => {
      const { container } = renderWithDesignSystem(
        <>
          <FeatureIllustration feature="braids" name="hero" />
          <FeatureIllustration feature="braids" name="hero" />
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
