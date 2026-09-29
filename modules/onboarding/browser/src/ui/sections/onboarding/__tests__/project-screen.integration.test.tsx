/**
 * @vitest-environment jsdom
 * Spec: modules/onboarding/specs/onboarding-project-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const calls = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: { team: "core" },
    push: (to: string) => calls.order.push(`push ${to}`),
  }),
}));

vi.mock("../../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => {},
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ organization: { id: "org_1" } }),
}));

vi.mock("../../../../ui/elements/setup-layout.tsx", () => ({
  SetupLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@langwatch/onboarding-browser-kit", () => ({
  TechStackSelector: () => null,
}));

vi.mock("../../../../behavior/onboarding-api.ts", () => ({
  api: {
    team: {
      getBySlug: { useQuery: () => ({ data: { id: "team_1" }, isFetched: true }) },
      getTeamsWithMembers: { useQuery: () => ({ data: [] }) },
    },
    project: {
      create: {
        useMutation: () => ({
          isPending: false,
          isSuccess: false,
          mutate: (
            _input: unknown,
            { onSuccess }: { onSuccess: (data: { projectSlug: string }) => Promise<void> },
          ) => void onSuccess({ projectSlug: "support-bot" }),
        }),
      },
    },
    useUtils: () => ({
      organization: {
        getAll: {
          invalidate: () => {
            calls.order.push("invalidate organization.getAll");
            return Promise.resolve();
          },
        },
      },
    }),
  },
}));

import ProjectOnboarding from "../project.screen.tsx";

afterEach(() => {
  cleanup();
  calls.order = [];
});

describe("ProjectOnboarding", () => {
  describe("when a project is created", () => {
    /** @scenario "Creating a project from onboarding opens the new project" */
    it("reads the workspace graph again, then opens the new project", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <ProjectOnboarding />
        </ChakraProvider>,
      );

      fireEvent.change(screen.getByRole("textbox"), { target: { value: "Support Bot" } });
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(calls.order).toEqual(["invalidate organization.getAll", "push /support-bot"]);
      });
    });
  });
});
