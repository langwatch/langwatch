/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => null,
}));

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "project-1", slug: "my-project" },
  })),
}));

vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: vi.fn(() => false),
}));

// The automations banner navigates via the compat router on CTA click.
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Stub the in-app Link primitive: it expects a Next router we don't have.
vi.mock("~/components/ui/link", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...(rest as Record<string, unknown>)}>{children}</a>
  ),
}));

// The Langy slides key off the panel's own visibility gate + the promo flag
// (spec: specs/home/langy-home-banner.feature). Both default OFF here so the
// pre-Langy tests above stay exactly as they were.
vi.mock("~/features/langy/hooks/useShowLangy", () => ({
  useShowLangy: vi.fn(() => false),
}));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: vi.fn(() => ({ enabled: false, isLoading: false })),
}));

import posthog from "posthog-js";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { HomePageBanners } from "../HomePageBanners";

const useOrganizationTeamProjectMock = vi.mocked(useOrganizationTeamProject);
const useShowLangyMock = vi.mocked(useShowLangy);
const useFeatureFlagMock = vi.mocked(useFeatureFlag);
const useReducedMotionMock = vi.mocked(useReducedMotion);

const VOICE_KEY = "langwatch:voice-agents-home-banner-dismissed:v1:project-1";
const AUTOMATIONS_KEY =
  "langwatch:automations-home-banner-dismissed:v1:project-1";
const LANGY_KEY = "langwatch:langy-home-banner-dismissed:v1:project-1";

/** The pill row next to a slide's heading — where the "New" badge lives. */
const headingRow = (name: string) =>
  within(screen.getByRole("heading", { name }).parentElement!);

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<HomePageBanners />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useOrganizationTeamProjectMock.mockReturnValue({
      project: { id: "project-1", slug: "my-project" },
    } as ReturnType<typeof useOrganizationTeamProject>);
    useShowLangyMock.mockReturnValue(false);
    useFeatureFlagMock.mockReturnValue({ enabled: false, isLoading: false });
    useReducedMotionMock.mockReturnValue(false);
    useLangyStore.setState({ isOpen: false });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("leads with the automations banner, with dots, when all are eligible", () => {
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", { name: "React the moment it matters" }),
    ).toBeDefined();
    // Two eligible banners → two navigation dots.
    expect(
      screen.getByRole("button", { name: "Show announcement 1 of 2" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Show announcement 2 of 2" }),
    ).toBeDefined();
  });

  it("shows the last remaining banner with no dots when only one is eligible", () => {
    localStorage.setItem(AUTOMATIONS_KEY, String(Date.now() + 60_000));
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "React the moment it matters" }),
    ).toBeNull();
    // One eligible banner → no carousel dots.
    expect(
      screen.queryByRole("button", { name: /Show announcement/ }),
    ).toBeNull();
  });

  it("renders nothing before the project id resolves", () => {
    // Before the project resolves the per-project snooze map can't be read,
    // so every slide would look eligible — a snoozed user would see a flash
    // and the automations CTA would push /undefined/automations.
    useOrganizationTeamProjectMock.mockReturnValue({
      project: undefined,
    } as ReturnType<typeof useOrganizationTeamProject>);
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.queryByRole("heading", { name: "React the moment it matters" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
  });

  it("renders nothing when every banner is snoozed", () => {
    localStorage.setItem(AUTOMATIONS_KEY, String(Date.now() + 60_000));
    localStorage.setItem(VOICE_KEY, String(Date.now() + 60_000));
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.queryByRole("heading", { name: "React the moment it matters" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
  });

  describe("when the user has neither Langy nor the promo flag", () => {
    it("shows no Langy banner and leaves the voice New pill alone", () => {
      renderWithProviders(<HomePageBanners />);
      expect(screen.queryByRole("heading", { name: "Meet Langy" })).toBeNull();
      expect(
        screen.queryByRole("heading", { name: "Langy is on its way" }),
      ).toBeNull();
      expect(
        headingRow("Voice agent simulations are here").getByText("New"),
      ).toBeDefined();
    });
  });

  describe("when the user is in the promo audience without Langy", () => {
    beforeEach(() => {
      useFeatureFlagMock.mockImplementation((key) => ({
        enabled: key === "release_langy_promo_enabled",
        isLoading: false,
      }));
    });

    it("leads with the Coming soon teaser and strips the voice New pill", () => {
      renderWithProviders(<HomePageBanners />);
      expect(
        headingRow("Langy is on its way").getByText("Coming soon"),
      ).toBeDefined();
      // The voice slide keeps its carousel spot but hands over the pill.
      expect(
        screen.getByRole("heading", {
          name: "Voice agent simulations are here",
        }),
      ).toBeDefined();
      expect(
        headingRow("Voice agent simulations are here").queryByText("New"),
      ).toBeNull();
      // Three eligible slides now.
      expect(
        screen.getByRole("button", { name: "Show announcement 3 of 3" }),
      ).toBeDefined();
    });

    it("opens the marketing site and captures the promo event on CTA", () => {
      const open = vi
        .spyOn(window, "open")
        .mockReturnValue(null as unknown as Window);
      renderWithProviders(<HomePageBanners />);
      fireEvent.click(screen.getByRole("button", { name: "Learn more" }));
      expect(open).toHaveBeenCalledWith(
        "https://langwatch.ai/langy",
        "_blank",
        "noopener,noreferrer",
      );
      expect(posthog.capture).toHaveBeenCalledWith("langy_promo_banner_click", {
        surface: "home_banner",
        projectId: "project-1",
      });
      open.mockRestore();
    });
  });

  describe("when the user has Langy", () => {
    beforeEach(() => {
      useShowLangyMock.mockReturnValue(true);
    });

    it("leads with the Meet Langy activation banner wearing the New pill", () => {
      renderWithProviders(<HomePageBanners />);
      expect(headingRow("Meet Langy").getByText("New")).toBeDefined();
      expect(
        headingRow("Voice agent simulations are here").queryByText("New"),
      ).toBeNull();
    });

    it("shows the toggle shortcut inside the Open Langy button", () => {
      renderWithProviders(<HomePageBanners />);
      // jsdom's navigator.platform is not a Mac, so the chip reads Ctrl+I.
      const button = screen.getByRole("button", { name: "Open Langy" });
      expect(within(button).getByText("Ctrl+I")).toBeDefined();
    });

    it("shows the activation banner, never the teaser, even inside the promo audience", () => {
      useFeatureFlagMock.mockImplementation((key) => ({
        enabled: key === "release_langy_promo_enabled",
        isLoading: false,
      }));
      renderWithProviders(<HomePageBanners />);
      expect(screen.getByRole("heading", { name: "Meet Langy" })).toBeDefined();
      expect(
        screen.queryByRole("heading", { name: "Langy is on its way" }),
      ).toBeNull();
    });

    it("opens the Langy panel in place, captures the activation event, and snoozes", () => {
      renderWithProviders(<HomePageBanners />);
      expect(useLangyStore.getState().isOpen).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Open Langy" }));
      // The hand-off: the panel opens right here — no navigation.
      expect(useLangyStore.getState().isOpen).toBe(true);
      expect(posthog.capture).toHaveBeenCalledWith("langy_activation", {
        surface: "home_banner",
        projectId: "project-1",
      });
      // The slide snoozes and hands the slot to the next slide.
      expect(localStorage.getItem(LANGY_KEY)).not.toBeNull();
      expect(screen.queryByRole("heading", { name: "Meet Langy" })).toBeNull();
    });

    it("types nothing under reduced motion — the first example ask shows statically", () => {
      useReducedMotionMock.mockReturnValue(true);
      renderWithProviders(<HomePageBanners />);
      expect(
        screen.getByText(
          "Find traces that failed their evaluations and tell me why",
        ),
      ).toBeDefined();
    });
  });
});
