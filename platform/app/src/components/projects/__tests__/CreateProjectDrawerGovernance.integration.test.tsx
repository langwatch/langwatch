/**
 * @vitest-environment jsdom
 *
 * ADR-144: an organisation admin creates an aggregate project from the
 * "Create New Project" drawer by checking Governance and picking the projects
 * it reads. The API is mocked at its boundary; the claims are about what the
 * drawer offers and what it sends.
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
          mutate: (params: Record<string, unknown>) => {
            mutateCalls.push(params);
          },
          isPending: false,
          error: null,
        }),
      },
      aggregateMemberCandidates: {
        useQuery: () => ({ data: CANDIDATES, error: null }),
      },
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

describe("<CreateProjectDrawer/> Governance", () => {
  beforeEach(() => {
    organizationRole = "ADMIN";
    mutateCalls = [];
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an organisation admin", () => {
    describe("when she checks Governance, picks two projects and creates", () => {
      /** @scenario "An admin creates an aggregate from the new project drawer by picking projects" */
      it("lists the projects in two sections and sends an aggregate with an explicit rule over the two", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.type(screen.getByPlaceholderText("AI Project"), "Company");
        await user.click(screen.getByRole("checkbox", { name: "Governance" }));

        const personal = screen
          .getByText("Personal projects")
          .closest("fieldset") as HTMLElement;
        const llmOps = screen
          .getByText("LLMOps projects")
          .closest("fieldset") as HTMLElement;
        expect(within(personal).getByText("Eve's workspace")).toBeVisible();
        expect(within(personal).getByText("Eve Engineer")).toBeVisible();
        expect(within(personal).getByText("sid@acme.test")).toBeVisible();
        expect(within(llmOps).getByText("Support chatbot")).toBeVisible();
        expect(
          within(llmOps).queryByText("Eve's workspace"),
        ).not.toBeInTheDocument();

        await user.click(
          screen.getByRole("checkbox", { name: /Eve's workspace/ }),
        );
        await user.click(
          screen.getByRole("checkbox", { name: /Support chatbot/ }),
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
    });

    describe("when she checks Governance and picks nothing", () => {
      /** @scenario "Create stays disabled until a project is picked" */
      it("keeps Create disabled until one project is picked", async () => {
        const user = userEvent.setup();
        renderDrawer();

        expect(createButton()).toBeEnabled();
        await user.click(screen.getByRole("checkbox", { name: "Governance" }));
        expect(createButton()).toBeDisabled();

        await user.click(
          screen.getByRole("checkbox", { name: /Support chatbot/ }),
        );
        expect(createButton()).toBeEnabled();
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
