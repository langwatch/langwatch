// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Banner, BannerAction } from "../src/components/states/banner.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

describe("Banner", () => {
  describe("given a top placement", () => {
    /** @scenario "A top banner fits the top of the content panel" */
    it("marks itself as a top banner, so the panel's corner rules apply", () => {
      renderWithDesignSystem(
        <Banner placement="top" data-testid="banner">
          Evaluations are off.
        </Banner>,
      );
      expect(screen.getByTestId("banner").getAttribute("data-banner-placement")).toBe("top");
    });

    /** @scenario "Stacked top banners read as one band" */
    it("stacks as siblings, so only the last curves", () => {
      renderWithDesignSystem(
        <div>
          <Banner placement="top">First</Banner>
          <Banner placement="top">Second</Banner>
        </div>,
      );
      const banners = document.querySelectorAll("[data-banner-placement=top]");
      expect(banners).toHaveLength(2);
      expect(banners[0]?.nextElementSibling).toBe(banners[1]);
    });
  });

  describe("given no placement", () => {
    /** @scenario "An inline banner is a rounded card" */
    it("is an inline card", () => {
      renderWithDesignSystem(<Banner data-testid="banner">Saved.</Banner>);
      expect(screen.getByTestId("banner").getAttribute("data-banner-placement")).toBe("inline");
    });
  });

  describe("given a title, text, an action and a dismiss", () => {
    /** @scenario "A banner shows its title, text, action and dismiss" */
    it("shows each and calls back once on dismiss", () => {
      const onDismiss = vi.fn();
      renderWithDesignSystem(
        <Banner
          status="warning"
          title="Seats are full."
          action={<BannerAction>Upgrade your plan</BannerAction>}
          onDismiss={onDismiss}
        >
          New members can't join.
        </Banner>,
      );
      expect(screen.getByText("Seats are full.")).toBeTruthy();
      expect(screen.getByText("New members can't join.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Upgrade your plan" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an error status", () => {
    /** @scenario "An error banner is announced at once, any other politely" */
    it("is announced as an alert, and a warning as a status", () => {
      renderWithDesignSystem(
        <>
          <Banner status="error">Something failed.</Banner>
          <Banner status="warning">Seats are nearly full.</Banner>
        </>,
      );
      expect(screen.getByRole("alert").textContent).toContain("Something failed.");
      expect(screen.getByRole("status").textContent).toContain("Seats are nearly full.");
    });
  });
});
