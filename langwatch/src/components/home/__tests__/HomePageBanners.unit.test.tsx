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

// Stub the in-app Link primitive: it expects a Next router we don't have.
vi.mock("~/components/ui/link", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => (
    <a {...(rest as Record<string, unknown>)}>{children}</a>
  ),
}));

vi.mock("~/features/traces-v2/hooks/useTracesV2Preference", () => ({
  setTracesV2Preferred: vi.fn(),
}));

import { HomePageBanners } from "../HomePageBanners";

const TRACES_KEY = "langwatch:tracesV2-home-banner-dismissed:v2:try:project-1";
const VOICE_KEY = "langwatch:voice-agents-home-banner-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("<HomePageBanners />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders the traces-v2 banner when the coin flip lands < 0.5", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", {
        name: "The new Trace Explorer is here",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
  });

  it("renders the voice banner when the coin flip lands >= 0.5", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", {
        name: "The new Trace Explorer is here",
      }),
    ).toBeNull();
  });

  it("forces the voice banner when only traces-v2 is snoozed (no coin flip)", () => {
    localStorage.setItem(TRACES_KEY, String(Date.now() + 60_000));
    vi.spyOn(Math, "random").mockReturnValue(0.9); // would pick traces if eligible
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeDefined();
  });

  it("forces the traces-v2 banner when only voice-agents is snoozed (no coin flip)", () => {
    localStorage.setItem(VOICE_KEY, String(Date.now() + 60_000));
    vi.spyOn(Math, "random").mockReturnValue(0.1); // would pick voice if eligible
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.getByRole("heading", {
        name: "The new Trace Explorer is here",
      }),
    ).toBeDefined();
  });

  it("renders neither banner when both are snoozed", () => {
    localStorage.setItem(TRACES_KEY, String(Date.now() + 60_000));
    localStorage.setItem(VOICE_KEY, String(Date.now() + 60_000));
    renderWithProviders(<HomePageBanners />);
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", {
        name: "The new Trace Explorer is here",
      }),
    ).toBeNull();
  });
});
