/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    project: { id: "project-1" },
  })),
}));

vi.mock("~/hooks/useReducedMotion", () => ({
  useReducedMotion: vi.fn(() => false),
}));

import posthog from "posthog-js";
import {
  isVoiceAgentsBannerSnoozed,
  VoiceAgentsHomeBanner,
} from "../VoiceAgentsHomeBanner";

const STORAGE_KEY = "langwatch:voice-agents-home-banner-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("<VoiceAgentsHomeBanner />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders the heading, NEW pill and CTA when not snoozed", () => {
    renderWithProviders(<VoiceAgentsHomeBanner />);
    expect(
      screen.getByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeDefined();
    expect(screen.getByText("New")).toBeDefined();
    expect(screen.getByText("Try voice agent testing")).toBeDefined();
  });

  it("CTA links to the public docs in a new tab with rel noopener noreferrer", () => {
    renderWithProviders(<VoiceAgentsHomeBanner />);
    const link = screen.getByRole("link", {
      name: /Open Voice Agents getting started guide in a new tab/i,
    });
    expect(link.getAttribute("href")).toBe(
      "https://langwatch.ai/scenario/voice/getting-started",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("captures a PostHog event when the CTA is clicked", () => {
    renderWithProviders(<VoiceAgentsHomeBanner />);
    const link = screen.getByRole("link", {
      name: /Open Voice Agents getting started guide in a new tab/i,
    });
    fireEvent.click(link);
    expect(posthog.capture).toHaveBeenCalledWith(
      "voice_agents_banner_click",
      expect.objectContaining({
        surface: "home_banner",
        projectId: "project-1",
      }),
    );
  });

  it("snoozes for ~7 days when dismissed and hides immediately", () => {
    renderWithProviders(<VoiceAgentsHomeBanner />);
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    const before = Date.now();
    fireEvent.click(dismissBtn);

    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const expiresAt = Number(raw);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    // Allow generous tolerance for slow CI.
    expect(expiresAt).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + SEVEN_DAYS_MS + 5000);
  });

  it("does not render when already snoozed", () => {
    localStorage.setItem(
      STORAGE_KEY,
      String(Date.now() + 24 * 60 * 60 * 1000),
    );
    renderWithProviders(<VoiceAgentsHomeBanner />);
    expect(
      screen.queryByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeNull();
  });

  it("re-renders the banner once an expired snooze passes", () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() - 1000));
    renderWithProviders(<VoiceAgentsHomeBanner />);
    expect(
      screen.getByRole("heading", {
        name: "Voice agent simulations are here",
      }),
    ).toBeDefined();
  });
});

describe("isVoiceAgentsBannerSnoozed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("returns false when no snooze is set", () => {
    expect(isVoiceAgentsBannerSnoozed("project-x")).toBe(false);
  });

  it("returns true when snooze is in the future", () => {
    localStorage.setItem(
      "langwatch:voice-agents-home-banner-dismissed:v1:project-x",
      String(Date.now() + 60_000),
    );
    expect(isVoiceAgentsBannerSnoozed("project-x")).toBe(true);
  });

  it("returns false when snooze has expired", () => {
    localStorage.setItem(
      "langwatch:voice-agents-home-banner-dismissed:v1:project-x",
      String(Date.now() - 60_000),
    );
    expect(isVoiceAgentsBannerSnoozed("project-x")).toBe(false);
  });

  it("returns false when the stored value is not a finite number", () => {
    localStorage.setItem(
      "langwatch:voice-agents-home-banner-dismissed:v1:project-x",
      "not-a-number",
    );
    expect(isVoiceAgentsBannerSnoozed("project-x")).toBe(false);
  });
});
