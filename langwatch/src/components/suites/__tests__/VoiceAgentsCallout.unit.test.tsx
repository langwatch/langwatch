/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    project: { id: "project-1" },
  })),
}));

import posthog from "posthog-js";
import { VoiceAgentsCallout } from "../VoiceAgentsCallout";

const STORAGE_KEY =
  "langwatch:simulations-voice-callout-dismissed:v1:project-1";

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>,
  );
}

describe("<VoiceAgentsCallout />", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("renders the title and CTA when not snoozed", () => {
    renderWithProviders(<VoiceAgentsCallout />);
    expect(screen.getByText("Try voice agent simulations")).toBeDefined();
    expect(screen.getByText("Get started")).toBeDefined();
  });

  it("links to the public docs in a new tab with rel noopener noreferrer", () => {
    renderWithProviders(<VoiceAgentsCallout />);
    const link = screen.getByRole("link", {
      name: /Open Voice Agents getting started guide in a new tab/i,
    });
    expect(link.getAttribute("href")).toBe(
      "https://langwatch.ai/scenario/voice/getting-started",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("captures a PostHog event when the callout is clicked", () => {
    renderWithProviders(<VoiceAgentsCallout />);
    const link = screen.getByRole("link", {
      name: /Open Voice Agents getting started guide in a new tab/i,
    });
    fireEvent.click(link);
    expect(posthog.capture).toHaveBeenCalledWith(
      "voice_agents_callout_click",
      expect.objectContaining({
        surface: "simulations_sidebar",
        projectId: "project-1",
      }),
    );
  });

  it("dismiss button hides the callout, snoozes for ~14 days, and does not capture a click event", () => {
    renderWithProviders(<VoiceAgentsCallout />);
    const dismissBtn = screen.getByRole("button", { name: "Dismiss" });
    const before = Date.now();
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Try voice agent simulations")).toBeNull();
    expect(posthog.capture).not.toHaveBeenCalledWith(
      "voice_agents_callout_click",
      expect.anything(),
    );

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const expiresAt = Number(raw);
    const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + FOURTEEN_DAYS_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(before + FOURTEEN_DAYS_MS + 5000);
  });

  it("does not render when already snoozed", () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + 60_000));
    renderWithProviders(<VoiceAgentsCallout />);
    expect(screen.queryByText("Try voice agent simulations")).toBeNull();
  });

  it("renders again once snooze has expired", () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() - 1000));
    renderWithProviders(<VoiceAgentsCallout />);
    expect(screen.getByText("Try voice agent simulations")).toBeDefined();
  });
});
