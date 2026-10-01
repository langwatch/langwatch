/**
 * @vitest-environment jsdom
 * Spec: modules/onboarding/specs/onboarding-project-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type Team = { id: string; name: string; projects: { id: string }[] };

const state = vi.hoisted(() => ({
  order: [] as string[],
  mutations: [] as unknown[],
  query: { team: "core" } as Record<string, string>,
  teamBySlug: { id: "team_1" } as { id: string } | undefined,
  teams: [] as Team[],
  error: null as Error | null,
  signOut: vi.fn(),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    query: state.query,
    push: (to: string) => state.order.push(`push ${to}`),
  }),
}));

vi.mock("../../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => {},
}));

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ organization: { id: "org_1" } }),
}));

vi.mock("../../../../model/onboarding-host.ts", () => ({
  useOnboardingHost: () => ({ signOut: state.signOut }),
}));

vi.mock("@langwatch/onboarding-browser-kit", () => ({
  TechStackSelector: () => null,
}));

vi.mock("../../../../behavior/onboarding-api.ts", () => ({
  api: {
    team: {
      getBySlug: { useQuery: () => ({ data: state.teamBySlug, isFetched: true }) },
      getTeamsWithMembers: { useQuery: () => ({ data: state.teams }) },
    },
    project: {
      create: {
        useMutation: () => ({
          isPending: false,
          isSuccess: false,
          error: state.error,
          mutate: (
            input: unknown,
            { onSuccess }: { onSuccess: (data: { projectSlug: string }) => Promise<void> },
          ) => {
            state.mutations.push(input);
            void onSuccess({ projectSlug: "support-bot" });
          },
        }),
      },
    },
    useUtils: () => ({
      organization: {
        getAll: {
          invalidate: () => {
            state.order.push("invalidate organization.getAll");
            return Promise.resolve();
          },
        },
      },
    }),
  },
}));

import ProjectOnboarding from "../project.screen.tsx";

function renderScreen() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ProjectOnboarding />
    </ChakraProvider>,
  );
}

function nameProject(name: string) {
  fireEvent.change(screen.getByTestId("onboarding-project-name"), { target: { value: name } });
}

beforeEach(() => {
  state.order = [];
  state.mutations = [];
  state.query = { team: "core" };
  state.teamBySlug = { id: "team_1" };
  state.teams = [];
  state.error = null;
  state.signOut.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("ProjectOnboarding", () => {
  describe("when the screen opens", () => {
    it("shows the branded card with its heading, intro and Next action", () => {
      renderScreen();

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Create New Project");
      expect(screen.getByText(/separate projects for each service/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    });

    it("signs out through the host", () => {
      renderScreen();

      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

      expect(state.signOut).toHaveBeenCalledOnce();
    });
  });

  describe("when a project is created", () => {
    /** @scenario "Creating a project from onboarding opens the new project" */
    it("reads the workspace graph again, then opens the new project", async () => {
      renderScreen();

      nameProject("Support Bot");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(state.order).toEqual(["invalidate organization.getAll", "push /support-bot"]);
      });
      expect(state.mutations).toEqual([
        {
          organizationId: "org_1",
          name: "Support Bot",
          teamId: "team_1",
          newTeamName: undefined,
          language: "python",
          framework: "openai",
        },
      ]);
    });

    it("goes to a safe return address instead of the project", async () => {
      state.query = { team: "core", return_to: "/settings/projects" };
      renderScreen();

      nameProject("Support Bot");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(state.order).toEqual(["invalidate organization.getAll", "push /settings/projects"]);
      });
    });

    it("ignores a scheme-relative return address", async () => {
      state.query = { team: "core", return_to: "//evil.example" };
      renderScreen();

      nameProject("Support Bot");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(state.order).toEqual(["invalidate organization.getAll", "push /support-bot"]);
      });
    });
  });

  describe("when the project has no name", () => {
    it("does not submit until it is named", async () => {
      renderScreen();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
      });
      expect(state.mutations).toEqual([]);
      nameProject("Support Bot");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(state.mutations).toEqual([expect.objectContaining({ name: "Support Bot" })]);
      });
    });
  });

  describe("when the organization already has a team with projects", () => {
    beforeEach(() => {
      state.teams = [{ id: "team_1", name: "Core", projects: [{ id: "project_1" }] }];
    });

    it("offers the team picker, and a new team's name once asked for", async () => {
      renderScreen();

      const picker = screen.getByRole("combobox");
      expect(screen.getByRole("option", { name: "(+) Create new team" })).toBeInTheDocument();
      expect(screen.queryByText("New Team Name")).not.toBeInTheDocument();

      fireEvent.change(picker, { target: { value: "NEW" } });

      expect(await screen.findByText("New Team Name")).toBeInTheDocument();
    });

    it("creates the project in a new team without a team id", async () => {
      renderScreen();

      nameProject("Support Bot");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "NEW" } });
      const teamName = (await screen.findAllByRole("textbox")).at(-1);
      if (!teamName) throw new Error("the new team's name field did not render");
      fireEvent.change(teamName, { target: { value: "Platform" } });
      fireEvent.click(screen.getByRole("button", { name: "Next" }));

      await waitFor(() => {
        expect(state.mutations).toEqual([
          expect.objectContaining({ teamId: undefined, newTeamName: "Platform" }),
        ]);
      });
    });
  });

  describe("when the organization has no team with projects", () => {
    it("hides the team picker", () => {
      renderScreen();

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });
  });

  describe("when creating fails", () => {
    it("says something went wrong", () => {
      state.error = new Error("boom");
      renderScreen();

      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong!");
    });
  });

  describe("when the team in the address does not exist", () => {
    it("shows the not-found page", () => {
      state.teamBySlug = undefined;
      renderScreen();

      expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
      expect(screen.queryByText("Create New Project")).not.toBeInTheDocument();
    });
  });
});
