/**
 * @vitest-environment jsdom
 *
 * ADR-144: an organisation admin creates an aggregate project from the
 * "Create New Project" drawer by checking Governance, then picking what it
 * governs from one select: personal projects (all, or one department's) or
 * specific projects, which a second select names. The API is mocked at its boundary; the claims are
 * about what the drawer offers and what it sends.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CreateProjectDrawer } from "../CreateProjectDrawer";

const ORG_ID = "org-acme";

let organizationRole: "ADMIN" | "MEMBER" = "ADMIN";
let mutateCalls: Array<Record<string, unknown>> = [];
let createdSlug: string | null = null;
let candidatesQuery: { data: unknown; error: unknown } = {
  data: null,
  error: null,
};
let departmentsQuery: { data: unknown } = { data: [] };

const DEPARTMENTS = [
  { id: "dept-eng", name: "Engineering", organizationId: "org-acme" },
  { id: "dept-sales", name: "Sales", organizationId: "org-acme" },
];

const CANDIDATES = [
  {
    id: "project-eve",
    name: "Eve's workspace",
    isPersonal: true,
    owner: { name: "Eve Engineer", email: "eve@acme.test" },
  },
  {
    id: "project-sid",
    name: "Sid's workspace",
    isPersonal: true,
    owner: { name: null, email: "sid@acme.test" },
  },
  {
    id: "project-chatbot",
    name: "Support chatbot",
    isPersonal: false,
    owner: null,
  },
];

vi.mock(
  "../../../hooks/useOrganizationTeamProject",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useOrganizationTeamProject: vi.fn(() => ({
      organization: { id: ORG_ID, name: "ACME" },
      organizations: [
        { id: ORG_ID, name: "ACME", members: [{ role: organizationRole }] },
      ],
      project: null,
    })),
  }),
);

vi.mock("../../../hooks/useDrawer", () => ({
  useDrawer: vi.fn(() => ({ closeDrawer: vi.fn() })),
}));

vi.mock("../../../utils/tracking", () => ({ trackEvent: vi.fn() }));

vi.mock("../../ui/toaster", () => ({ toaster: { create: vi.fn() } }));

const hardRedirect = vi.hoisted(() => vi.fn());
vi.mock("../../../utils/hardRedirect", () => ({ hardRedirect }));

vi.mock("../../../utils/api", () => ({
  api: {
    useUtils: vi.fn(() => ({
      organization: { getAll: { invalidate: vi.fn() } },
      limits: { getUsage: { invalidate: vi.fn() } },
      team: {
        getTeamsWithMembers: { invalidate: vi.fn() },
        getTeamWithMembers: { invalidate: vi.fn() },
        getTeamsWithRoleBindings: { invalidate: vi.fn() },
      },
    })),
    project: {
      create: {
        useMutation: () => ({
          mutate: (
            params: Record<string, unknown>,
            options?: {
              onSuccess?: (result: { projectSlug: string }) => void;
            },
          ) => {
            mutateCalls.push(params);
            if (createdSlug) options?.onSuccess?.({ projectSlug: createdSlug });
          },
          isPending: false,
          error: null,
        }),
      },
      aggregateMemberCandidates: {
        useQuery: () => candidatesQuery,
      },
    },
    departments: {
      list: { useQuery: () => departmentsQuery },
    },
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [{ id: "team-1", name: "Platform", projects: [{}] }],
          isLoading: false,
        }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = () =>
  render(<CreateProjectDrawer organizationId={ORG_ID} />, {
    wrapper: Wrapper,
  });

const createButton = () => screen.getByRole("button", { name: "Create" });
const ruleTrigger = () =>
  screen.getByRole("combobox", { name: "What do you want to govern?" });
const projectsTrigger = () =>
  screen.getByRole("combobox", { name: "Projects" });
const PICK_ONE = "Pick at least one project.";
const EVERYONE =
  "Everyone's personal project, including people who join later.";

type User = ReturnType<typeof userEvent.setup>;
const checkGovernance = (user: User) =>
  user.click(screen.getByRole("checkbox", { name: "Governance" }));
const openProjects = (user: User) => user.click(projectsTrigger());
const chooseRule = async (user: User, name: string) => {
  await user.click(ruleTrigger());
  await user.click(screen.getByRole("option", { name }));
};

describe("<CreateProjectDrawer/> Governance", () => {
  beforeEach(() => {
    organizationRole = "ADMIN";
    mutateCalls = [];
    createdSlug = null;
    hardRedirect.mockReset();
    candidatesQuery = { data: CANDIDATES, error: null };
    departmentsQuery = { data: [] };
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an organisation admin", () => {
    describe("when she checks Governance and creates straight away", () => {
      /** @scenario "Governance covers every personal project by default" */
      it("reads All personal projects, says who it covers and sends the all-personal rule", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Company");
        await checkGovernance(user);

        expect(ruleTrigger()).toHaveTextContent(
          "All personal projects (coding agents)",
        );
        expect(screen.getByText(EVERYONE)).toBeVisible();
        expect(
          screen.queryByRole("combobox", { name: "Projects" }),
        ).not.toBeInTheDocument();

        expect(createButton()).toBeEnabled();
        await user.click(createButton());

        await waitFor(() => expect(mutateCalls).toHaveLength(1));
        expect(mutateCalls[0]).toMatchObject({
          organizationId: ORG_ID,
          name: "Company",
          kind: "aggregate",
          aggregateRule: { kind: "all-personal" },
        });
      });
    });

    describe("when the organisation has departments and she picks one", () => {
      /** @scenario "An admin narrows personal projects to one department" */
      it("offers each department under personal projects and sends the by-department rule", async () => {
        departmentsQuery = { data: DEPARTMENTS };
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Company");
        await checkGovernance(user);
        await user.click(ruleTrigger());

        const personal = screen.getByRole("group", {
          name: "Personal projects (coding agents)",
        });
        expect(
          within(personal)
            .getAllByRole("option")
            .map((option) => option.textContent),
        ).toEqual(["All departments", "Engineering", "Sales"]);
        const projects = screen.getByRole("group", { name: "Projects" });
        expect(
          within(projects)
            .getAllByRole("option")
            .map((option) => option.textContent),
        ).toEqual(["Specific projects"]);

        await user.click(screen.getByRole("option", { name: "Engineering" }));

        expect(ruleTrigger()).toHaveTextContent(
          "Personal projects in Engineering",
        );
        expect(
          screen.getByText(
            "Personal projects of everyone in Engineering, including people who join later.",
          ),
        ).toBeVisible();
        expect(screen.queryByText(EVERYONE)).not.toBeInTheDocument();
        await user.click(createButton());

        await waitFor(() => expect(mutateCalls).toHaveLength(1));
        expect(mutateCalls[0]).toMatchObject({
          kind: "aggregate",
          aggregateRule: {
            kind: "personal-by-department",
            departmentId: "dept-eng",
          },
        });
      });
    });

    describe("when the organisation has no departments", () => {
      /** @scenario "An organisation without departments is not offered a department choice" */
      it("offers only All personal projects under personal projects", async () => {
        departmentsQuery = { data: [] };
        const user = userEvent.setup();
        renderDrawer();

        await checkGovernance(user);
        await user.click(ruleTrigger());

        const personal = screen.getByRole("group", {
          name: "Personal projects (coding agents)",
        });
        expect(
          within(personal)
            .getAllByRole("option")
            .map((option) => option.textContent),
        ).toEqual(["All personal projects"]);
      });
    });

    describe("when she picks Specific projects, then two projects, and creates", () => {
      /** @scenario "An admin picks specific projects from a dropdown" */
      it("opens a second select with both groups and each owner's email, and sends an explicit rule over the two", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Company");
        await checkGovernance(user);
        await chooseRule(user, "Specific projects");

        expect(ruleTrigger()).toHaveTextContent("Specific projects");
        expect(screen.queryByText(EVERYONE)).not.toBeInTheDocument();
        await openProjects(user);

        const personal = screen.getByRole("group", {
          name: "Personal projects",
        });
        const llmOps = screen.getByRole("group", { name: "LLMOps projects" });
        expect(
          within(personal).getByRole("option", { name: /Eve's workspace/ }),
        ).toBeInTheDocument();
        expect(within(personal).getByText("eve@acme.test")).toBeInTheDocument();
        expect(within(personal).getByText("sid@acme.test")).toBeInTheDocument();
        expect(
          within(llmOps).getByRole("option", { name: /Support chatbot/ }),
        ).toBeInTheDocument();
        expect(
          within(llmOps).queryByRole("option", { name: /Eve's workspace/ }),
        ).not.toBeInTheDocument();

        await user.click(
          screen.getByRole("option", { name: /Eve's workspace/ }),
        );
        await user.click(
          screen.getByRole("option", { name: /Support chatbot/ }),
        );
        await user.keyboard("{Escape}");

        expect(projectsTrigger()).toHaveTextContent(
          "Eve's workspace, Support chatbot",
        );
        await user.click(createButton());

        await waitFor(() => expect(mutateCalls).toHaveLength(1));
        expect(mutateCalls[0]).toMatchObject({
          organizationId: ORG_ID,
          name: "Company",
          kind: "aggregate",
          aggregateRule: {
            kind: "explicit",
            projectIds: ["project-eve", "project-chatbot"],
          },
        });
      });

      it("counts the picks once more than two are chosen", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await checkGovernance(user);
        await chooseRule(user, "Specific projects");
        await openProjects(user);
        for (const name of [
          /Eve's workspace/,
          /Sid's workspace/,
          /Support chatbot/,
        ]) {
          await user.click(screen.getByRole("option", { name }));
        }
        await user.keyboard("{Escape}");

        expect(projectsTrigger()).toHaveTextContent("3 projects");
      });
    });

    describe("when she picks a department, then specific projects, then All departments", () => {
      it("hides the project select again and sends the all-personal rule", async () => {
        departmentsQuery = { data: DEPARTMENTS };
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Company");
        await checkGovernance(user);
        await chooseRule(user, "Engineering");
        await chooseRule(user, "Specific projects");
        expect(projectsTrigger()).toBeInTheDocument();
        await chooseRule(user, "All departments");

        expect(
          screen.queryByRole("combobox", { name: "Projects" }),
        ).not.toBeInTheDocument();
        await user.click(createButton());

        await waitFor(() => expect(mutateCalls).toHaveLength(1));
        expect(mutateCalls[0]).toMatchObject({
          aggregateRule: { kind: "all-personal" },
        });
      });
    });

    describe("when she picks Specific projects and no project", () => {
      /** @scenario "Create stays disabled until a project is picked" */
      it("keeps Create disabled and says why until one project is picked", async () => {
        const user = userEvent.setup();
        renderDrawer();

        expect(createButton()).toBeEnabled();
        await checkGovernance(user);
        expect(createButton()).toBeEnabled();

        await chooseRule(user, "Specific projects");
        expect(createButton()).toBeDisabled();
        expect(screen.getByText(PICK_ONE)).toBeVisible();

        await openProjects(user);
        await user.click(
          screen.getByRole("option", { name: /Support chatbot/ }),
        );
        expect(createButton()).toBeEnabled();
        expect(screen.queryByText(PICK_ONE)).not.toBeInTheDocument();
      });
    });

    describe("when she creates without checking Governance", () => {
      /** @scenario "Without Governance the drawer creates an ordinary project" */
      it("sends no project kind and no rule", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Chatbot");
        await user.click(createButton());

        await waitFor(() => expect(mutateCalls).toHaveLength(1));
        expect(mutateCalls[0]).toMatchObject({
          organizationId: ORG_ID,
          name: "Chatbot",
          teamId: "team-1",
        });
        expect(mutateCalls[0]).not.toHaveProperty("kind");
        expect(mutateCalls[0]).not.toHaveProperty("aggregateRule");
      });
    });
  });

  describe("given the drawer opens the project it creates", () => {
    const createAndOpen = async ({ governance }: { governance: boolean }) => {
      createdSlug = governance ? "company-traces" : "chatbot";
      const user = userEvent.setup();
      render(<CreateProjectDrawer organizationId={ORG_ID} navigateOnCreate />, {
        wrapper: Wrapper,
      });
      await user.type(screen.getByPlaceholderText("AI Project"), "Company");
      if (governance) await checkGovernance(user);
      await user.click(createButton());
      await waitFor(() => expect(mutateCalls).toHaveLength(1));
    };

    describe("when ana creates an aggregate", () => {
      /** @scenario "A new aggregate opens on its Trace Explorer" */
      it("opens the new aggregate's Trace Explorer, not its home", async () => {
        await createAndOpen({ governance: true });

        expect(hardRedirect).toHaveBeenCalledWith("/company-traces/traces");
      });
    });

    describe("when ana creates an ordinary project", () => {
      it("opens the new project's home", async () => {
        await createAndOpen({ governance: false });

        expect(hardRedirect).toHaveBeenCalledWith("/chatbot");
      });
    });
  });

  describe("given listing the projects to pick fails", () => {
    const MISSING_PROCEDURE = `No procedure found on path "project.aggregateMemberCandidates"`;

    describe("when the server answers with a message of its own", () => {
      /** @scenario "A project list that fails to load never shows the server's own words" */
      it("shows the picker's own copy and the error ID, never the server's message", async () => {
        // The answer a server without the procedure sends: tRPC writes the
        // message itself, with no cause, so the boundary marks it authored.
        candidatesQuery = {
          data: undefined,
          error: {
            message: MISSING_PROCEDURE,
            data: {
              code: "NOT_FOUND",
              httpStatus: 404,
              path: "project.aggregateMemberCandidates",
              error: null,
              authored: true,
              traceId: "trace-acme-1",
            },
          },
        };
        const user = userEvent.setup();
        renderDrawer();

        await checkGovernance(user);
        await chooseRule(user, "Specific projects");

        const alert = screen.getByRole("alert");
        expect(
          within(alert).getByText("Couldn't list this organization's projects"),
        ).toBeVisible();
        expect(
          within(alert).getByText(
            "We've been notified. Try again in a moment.",
          ),
        ).toBeVisible();
        // The copy button where a clipboard API exists, the id as selectable
        // text where it does not (jsdom, unless user-event has stubbed one).
        const errorId =
          within(alert).queryByRole("button", { name: /Copy error ID/ }) ??
          within(alert).queryByText("Error ID: trace-acme-1");
        expect(errorId).toBeVisible();
        expect(screen.queryByText(MISSING_PROCEDURE)).not.toBeInTheDocument();
        expect(
          screen.queryByText(/aggregateMemberCandidates/),
        ).not.toBeInTheDocument();
      });
    });

    describe("when the server refuses a caller who is not an organisation admin", () => {
      /** @scenario "A project list refused to a non-admin says who can pick projects" */
      it("says only organisation admins can do this", async () => {
        candidatesQuery = {
          data: undefined,
          error: {
            message: "aggregate_project_admin_only",
            data: {
              code: "FORBIDDEN",
              httpStatus: 403,
              error: {
                code: "aggregate_project_admin_only",
                httpStatus: 403,
                fault: "customer",
                traceId: "trace-acme-2",
              },
              authored: false,
              traceId: "trace-acme-2",
            },
          },
        };
        const user = userEvent.setup();
        renderDrawer();

        await checkGovernance(user);
        await chooseRule(user, "Specific projects");

        const alert = screen.getByRole("alert");
        expect(
          within(alert).getByText("Only organization admins can do this"),
        ).toBeVisible();
        expect(
          screen.queryByText("aggregate_project_admin_only"),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given a member who is not an organisation admin", () => {
    describe("when the member opens the drawer", () => {
      /** @scenario "A member who is not an admin sees no Governance checkbox" */
      it("shows no Governance checkbox", () => {
        organizationRole = "MEMBER";
        renderDrawer();

        expect(screen.getByPlaceholderText("AI Project")).toBeInTheDocument();
        expect(
          screen.queryByRole("checkbox", { name: "Governance" }),
        ).not.toBeInTheDocument();
      });
    });
  });
});
