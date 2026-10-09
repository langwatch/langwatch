/**
 * @vitest-environment jsdom
 * ADR-177 decision 7: an aggregate project owns no credential and is never sent
 * a trace, so its setup card offers no key and waits for nothing.
 * Spec: specs/governance/aggregate-project.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const state = vi.hoisted(() => ({ kind: "application" as string | undefined }));

vi.mock("../../../../model/onboarding-host.ts", () => ({
  useOnboardingHost: () => ({
    scope: () => ({
      organization: { id: "org_1" },
      project: { id: "project_1", name: "Acme", slug: "acme", kind: state.kind },
    }),
    currentUser: () => ({ id: "user_1" }),
    copyToClipboard: vi.fn(),
  }),
}));
vi.mock("@langwatch/api-key-client", () => ({
  useMintPersonalToken: () => ({ token: void 0, isMinting: false, mint: vi.fn() }),
}));
vi.mock("@langwatch/browser-host/capabilities", () => ({
  useUiDeployment: () => ({ appBaseUrl: "https://app.langwatch.ai" }),
}));
vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../integration-checks.tsx", () => ({
  useIntegrationChecks: () => ({ data: { firstMessage: false } }),
}));
vi.mock("../../observability/project-token-banner.tsx", () => ({
  ProjectTokenBanner: () => null,
}));
vi.mock("../../../elements/welcome/observability-card.tsx", () => ({
  default: () => <div data-testid="observability-card" />,
}));

import APICard from "../api-card.tsx";

function renderCard() {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <APICard />
    </DesignSystemProvider>,
  );
}

afterEach(() => {
  cleanup();
  state.kind = "application";
});

describe("<APICard />", () => {
  describe("when the open project is an aggregate", () => {
    /** @scenario "Aggregate onboarding mints no credential" */
    it("says data can't be added, and shows no key and no wait for a first trace", () => {
      state.kind = "aggregate";

      renderCard();

      expect(screen.getByText("Data can't be added to this project")).toBeInTheDocument();
      expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
      expect(screen.queryByText("Waiting for first trace...")).not.toBeInTheDocument();
    });
  });

  describe("when the open project is an ordinary one", () => {
    it("shows the setup and waits for the first trace", () => {
      renderCard();

      expect(screen.getByText("Waiting for first trace...")).toBeInTheDocument();
      expect(screen.queryByText("Data can't be added to this project")).not.toBeInTheDocument();
    });
  });
});
