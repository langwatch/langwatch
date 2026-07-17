/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { HomePageBanners } from "../HomePageBanners";

const useOrganizationTeamProjectMock = vi.mocked(useOrganizationTeamProject);

const VOICE_KEY = "langwatch:voice-agents-home-banner-dismissed:v1:project-1";
const AUTOMATIONS_KEY =
  "langwatch:automations-home-banner-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("<HomePageBanners />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useOrganizationTeamProjectMock.mockReturnValue({
      project: { id: "project-1", slug: "my-project" },
    } as ReturnType<typeof useOrganizationTeamProject>);
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
});
