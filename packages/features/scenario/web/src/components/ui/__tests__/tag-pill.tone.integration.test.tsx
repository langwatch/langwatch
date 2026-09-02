/**
 * @vitest-environment jsdom
 *
 * A tag pill is one muted grey by default. Agent Testing asks for a soft
 * colour per label, so the tone is a choice the caller makes and the default
 * draws exactly what it drew before.
 *
 * @see specs/features/tag-management.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TagList } from "../tag-list";
import { pastelPaletteForLabel, TagPill } from "../tag-pill";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const pillFor = (label: string) => screen.getByTestId(`tag-pill-${label}`);

describe("<TagPill/> tone", () => {
  afterEach(cleanup);

  describe("given no tone", () => {
    it("draws what an explicitly neutral pill draws", () => {
      const { unmount } = render(<TagPill label="billing" />, {
        wrapper: Wrapper,
      });
      const untoned = pillFor("billing").className;
      unmount();

      render(<TagPill label="billing" tone="neutral" />, { wrapper: Wrapper });

      expect(pillFor("billing").className).toBe(untoned);
    });

    it("keeps every label on the same colour", () => {
      render(
        <>
          <TagPill label="billing" />
          <TagPill label="refunds" />
        </>,
        { wrapper: Wrapper },
      );

      expect(pillFor("billing").className).toBe(pillFor("refunds").className);
    });
  });

  describe("given the pastel tone", () => {
    it("colours a pill differently from the neutral one", () => {
      const { unmount } = render(<TagPill label="billing" />, {
        wrapper: Wrapper,
      });
      const neutral = pillFor("billing").className;
      unmount();

      render(<TagPill label="billing" tone="pastel" />, { wrapper: Wrapper });

      expect(pillFor("billing").className).not.toBe(neutral);
    });

    it("gives the same label the same colour every time", () => {
      expect(pastelPaletteForLabel("billing")).toBe(
        pastelPaletteForLabel("billing"),
      );
    });

    it("tells labels apart", () => {
      const palettes = new Set(
        ["billing", "refunds", "onboarding", "escalation"].map(
          pastelPaletteForLabel,
        ),
      );

      expect(palettes.size).toBeGreaterThan(1);
    });
  });

  describe("given a list of tags", () => {
    it("passes the tone to every pill", () => {
      const { unmount } = render(
        <TagList labels={["billing"]} tone="pastel" />,
        { wrapper: Wrapper },
      );
      const pastel = pillFor("billing").className;
      unmount();

      render(<TagList labels={["billing"]} />, { wrapper: Wrapper });

      expect(pillFor("billing").className).not.toBe(pastel);
    });
  });
});
