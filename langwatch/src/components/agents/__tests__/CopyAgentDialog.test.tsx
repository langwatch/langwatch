/**
 * @vitest-environment jsdom
 *
 * Tests for CopyAgentDialog – replicate agent to another project.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CopyAgentDialog } from "../CopyAgentDialog";

const SOURCE_PROJECT_ID = "test-project-id";
const TARGET_PROJECT_ID = "target-project-id";
const MOCK_ORGANIZATIONS = [
  {
    id: "org-1",
    name: "Org",
    teams: [
      {
        id: "team-1",
        name: "Team",
        members: [
          {
            userId: "user-1",
            role: "MEMBER",
            assignedRole: null,
          },
        ],
        projects: [
          { id: SOURCE_PROJECT_ID, name: "Current Project" },
          { id: TARGET_PROJECT_ID, name: "Target Project" },
        ],
      },
    ],
  },
];

let copyMutateArgs: { agentId: string; projectId: string; sourceProjectId: string } | null =
  null;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: SOURCE_PROJECT_ID, name: "Current Project" },
    organizations: MOCK_ORGANIZATIONS,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user-1" } },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      copy: {
        useMutation: () => ({
          mutateAsync: vi.fn(async (args: typeof copyMutateArgs) => {
            copyMutateArgs = args;
          }),
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

beforeAll(() => {
  Element.prototype.scrollTo = vi.fn();
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("CopyAgentDialog", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    agentId: "agent-1",
    agentName: "My Agent",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    copyMutateArgs = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders dialog title and target project field", () => {
    render(<CopyAgentDialog {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByText("Replicate Agent")).toBeInTheDocument();
    expect(screen.getByText("Target Project")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("Replicate button is disabled when no project selected", () => {
    render(<CopyAgentDialog {...defaultProps} />, { wrapper: Wrapper });
    const replicateBtn = screen.getByRole("button", { name: /replicate/i });
    expect(replicateBtn).toBeDisabled();
  });

  it("calls copy mutation and onClose when project selected and Replicate clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CopyAgentDialog {...defaultProps} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option", {
      name: /Org \/ Team \/ Target Project/,
      hidden: true,
    });
    await user.click(options[0]!);

    const replicateBtn = screen.getByRole("button", { name: /replicate/i });
    await waitFor(() => {
      expect(replicateBtn).not.toBeDisabled();
    });
    await user.click(replicateBtn);

    await waitFor(() => {
      expect(copyMutateArgs).not.toBeNull();
      expect(copyMutateArgs?.agentId).toBe("agent-1");
      expect(copyMutateArgs?.projectId).toBe(TARGET_PROJECT_ID);
      expect(copyMutateArgs?.sourceProjectId).toBe(SOURCE_PROJECT_ID);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("calls onSuccess after successful replicate", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      <CopyAgentDialog {...defaultProps} onSuccess={onSuccess} />,
      { wrapper: Wrapper },
    );

    await user.click(screen.getByRole("combobox"));
    const options = await screen.findAllByRole("option", {
      name: /Org \/ Team \/ Target Project/,
      hidden: true,
    });
    await user.click(options[0]!);
    await user.click(screen.getByRole("button", { name: /replicate/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it("Cancel button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CopyAgentDialog {...defaultProps} onClose={onClose} />,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
