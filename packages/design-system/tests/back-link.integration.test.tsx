// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackLink } from "../src/components/back-link.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("BackLink", () => {
  describe("when the reader clicks it", () => {
    it("routes a plain click through onNavigate and leaves a modified click to the browser", () => {
      const onNavigate = vi.fn<(href: string) => void>();
      renderWithDesignSystem(
        <BackLink href="/budgets" onNavigate={onNavigate}>
          Budgets
        </BackLink>,
      );

      const link = screen.getByRole("link", { name: "Budgets" });
      const followed = fireEvent.click(link);
      fireEvent.click(link, { metaKey: true });

      expect(followed).toBe(false);
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("/budgets");
    });
  });
});
