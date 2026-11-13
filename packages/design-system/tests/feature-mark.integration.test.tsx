// @vitest-environment jsdom
// Spec: packages/design-system/specs/feature-mark.feature

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FeatureMark } from "../src/components/brand/feature-mark.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

const RAW_COLOUR = /#[\da-f]{3,8}\b|rgba?\(/i;

function strands(container: HTMLElement) {
  return [...container.querySelectorAll("svg[data-feature] > g > path")];
}

const strokeOf = (element: Element) => getComputedStyle(element).stroke;

describe("FeatureMark", () => {
  describe("given the Braids mark in colour", () => {
    /** @scenario The colour mark paints its strands from the feature's colour tokens */
    it("paints the lead strand and the weave strands from the feature's tokens", () => {
      const { container } = renderWithDesignSystem(<FeatureMark feature="braids" size={40} />);
      const paths = strands(container);
      expect(paths).toHaveLength(3);
      const byTone = (tone: string) =>
        paths.filter((path) => path.getAttribute("data-tone") === tone);
      for (const path of byTone("lead")) {
        expect(strokeOf(path)).toBe("var(--chakra-colors-feature-braids-lead)");
      }
      for (const path of byTone("weave")) {
        expect(strokeOf(path)).toBe("var(--chakra-colors-feature-braids-weave)");
      }
      expect(byTone("lead")).toHaveLength(1);
      for (const path of paths) expect(path.outerHTML).not.toMatch(RAW_COLOUR);
    });
  });

  describe("given the Braids mark in one colour", () => {
    /** @scenario The mono mark takes the colour of the text around it */
    it("paints every strand in currentColor", () => {
      const { container } = renderWithDesignSystem(
        <span style={{ color: "rgb(1, 2, 3)" }}>
          <FeatureMark feature="braids" variant="mono" />
        </span>,
      );
      const paths = strands(container);
      expect(paths).toHaveLength(3);
      for (const path of paths) expect(strokeOf(path)).toBe("rgb(1, 2, 3)");
    });
  });

  describe("given the Braids mark at 20 pixels and at 40 pixels", () => {
    /** @scenario The mark draws its small master at 24 pixels and below */
    it("draws the small master below the threshold and the standard one above", () => {
      const { container } = renderWithDesignSystem(
        <>
          <FeatureMark feature="braids" size={20} />
          <FeatureMark feature="braids" size={40} />
        </>,
      );
      const [small, standard] = [...container.querySelectorAll("svg[data-feature]")];
      expect(small?.getAttribute("data-master")).toBe("small");
      expect(standard?.getAttribute("data-master")).toBe("standard");
      const weight = (svg: Element | undefined) =>
        Number(svg?.querySelector(":scope > g")?.getAttribute("stroke-width"));
      expect(weight(small)).toBeGreaterThan(weight(standard));
    });
  });

  describe("given two Braids marks on the same page", () => {
    /** @scenario Two marks on one page never share a mask */
    it("gives every mask its own id and points each cut inside its own mark", () => {
      const { container } = renderWithDesignSystem(
        <>
          <FeatureMark feature="braids" />
          <FeatureMark feature="braids" />
        </>,
      );
      const ids = [...container.querySelectorAll("mask")].map((mask) => mask.id);
      expect(ids.length).toBe(4);
      expect(new Set(ids).size).toBe(ids.length);
      for (const svg of container.querySelectorAll("svg[data-feature]")) {
        for (const path of svg.querySelectorAll("path[mask]")) {
          const id = path.getAttribute("mask")?.replace(/^url\(#(.*)\)$/, "$1") ?? "";
          expect(svg.querySelector(`mask[id="${id}"]`)).not.toBeNull();
        }
      }
    });
  });

  describe("given the Braids mark forced to dark mode on a light page", () => {
    /** @scenario The mark follows a forced colour mode */
    it("carries the dark colour-mode class", () => {
      const { container } = renderWithDesignSystem(
        <FeatureMark feature="braids" forceColorMode="dark" />,
      );
      expect(container.querySelector("svg[data-feature]")?.classList.contains("dark")).toBe(true);
    });
  });

  describe("given the Braids mark without a label, and one labelled Braids", () => {
    /** @scenario The mark is decorative unless it is given a name */
    it("hides the unlabelled mark and names the labelled one", () => {
      const { container } = renderWithDesignSystem(
        <>
          <FeatureMark feature="braids" />
          <FeatureMark feature="braids" label="Braids" />
        </>,
      );
      const [decorative] = [...container.querySelectorAll("svg[data-feature]")];
      expect(decorative?.getAttribute("aria-hidden")).toBe("true");
      expect(screen.getByRole("img", { name: "Braids" })).toBeTruthy();
    });
  });
});
