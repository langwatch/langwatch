/**
 * @vitest-environment jsdom
 *
 * ADR-144 decision 7: an aggregate project owns no credential and is never
 * sent a trace, so its setup page offers no key and waits for nothing.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { projectRef } = vi.hoisted(() => ({
  projectRef: {
    current: { id: "project_1", kind: "application", apiKey: "sk-lw-key" },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: projectRef.current }),
}));
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { BASE_HOST: "https://app.langwatch.ai" } }),
}));
vi.mock("~/components/IntegrationChecks", () => ({
  useIntegrationChecks: () => ({ data: { firstMessage: false } }),
}));
vi.mock("~/utils/tracking", () => ({ trackEvent: vi.fn() }));
vi.mock("~/components/welcome/ObservabilityCard", () => ({
  default: () => <div data-testid="observability-card" />,
}));

import APICard from "../APICard";

function renderCard() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <APICard />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  projectRef.current = {
    id: "project_1",
    kind: "application",
    apiKey: "sk-lw-key",
  };
});

describe("<APICard />", () => {
  describe("when the open project is an aggregate", () => {
    /** @scenario "Aggregate onboarding mints no credential" */
    it("says data can't be added, and shows no key and no wait for a first trace", () => {
      projectRef.current = {
        id: "project_aggregate",
        kind: "aggregate",
        apiKey: "",
      };

      renderCard();

      expect(
        screen.getByText("Data can't be added to this project"),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Waiting for first trace..."),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the open project is an ordinary one", () => {
    it("shows the key and waits for the first trace", () => {
      renderCard();

      expect(
        screen.getByText("Waiting for first trace..."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Data can't be added to this project"),
      ).not.toBeInTheDocument();
    });
  });
});
