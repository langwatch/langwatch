/**
 * @vitest-environment jsdom
 * The checklist's alert step asks automation itself, not onboarding's server (ARCHITECTURE §9).
 * Spec: modules/onboarding/specs/integrations-checks.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const automations = vi.hoisted(() => ({ rows: [] as { id: string }[] }));

vi.mock("react-feather", () => ({
  CheckCircle: () => <span>done</span>,
  Circle: () => <span>to do</span>,
}));

vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "project" } }),
}));

vi.mock("../../../behavior/onboarding-api.ts", () => ({
  api: {
    integrationsChecks: { getCheckStatus: { useQuery: () => ({ data: { firstMessage: true } }) } },
  },
}));

vi.mock("../../../behavior/automation-api.ts", () => ({
  automationApi: {
    automation: { getTriggers: { useQuery: () => ({ data: automations.rows }) } },
  },
}));

import { IntegrationChecks } from "../integration-checks.tsx";

function alertStep(): HTMLElement {
  render(
    <ChakraProvider value={defaultSystem}>
      <IntegrationChecks />
    </ChakraProvider>,
  );
  const step = screen.getByText("Set up an alert").closest("a");
  if (!step) throw new Error("the alert step rendered no link");
  return step;
}

describe("the setup checklist's alert step", () => {
  afterEach(() => {
    cleanup();
    automations.rows = [];
  });

  describe("given the project holds an automation", () => {
    /** @scenario "The alert step reads as done from automation's own list" */
    it("reads as done", () => {
      automations.rows = [{ id: "trigger-1" }];

      expect(within(alertStep()).getByText("done")).toBeInTheDocument();
    });
  });

  describe("given the project holds no automation", () => {
    /** @scenario "The alert step reads as done from automation's own list" */
    it("reads as to do", () => {
      expect(within(alertStep()).getByText("to do")).toBeInTheDocument();
    });
  });
});
