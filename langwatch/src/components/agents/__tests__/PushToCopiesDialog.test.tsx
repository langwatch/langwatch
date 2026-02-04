/**
 * @vitest-environment jsdom
 *
 * Tests for PushToCopiesDialog (agents) – push agent config to selected replicas.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushToCopiesDialog } from "../PushToCopiesDialog";

const MOCK_COPIES = [
  {
    id: "copy-1",
    name: "Replica A",
    projectId: "project-a",
    fullPath: "Org / Team / Project A",
  },
  {
    id: "copy-2",
    name: "Replica B",
    projectId: "project-b",
    fullPath: "Org / Team / Project B",
  },
];

let pushMutateArgs: {
  projectId: string;
  agentId: string;
  copyIds: string[];
} | null = null;

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", name: "Current Project" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      agents: { getAll: { invalidate: vi.fn() } },
    }),
    agents: {
      getCopies: {
        useQuery: (_: unknown, opts: { enabled?: boolean }) => ({
          data: opts?.enabled !== false ? MOCK_COPIES : undefined,
          isLoading: false,
          error: null,
        }),
      },
      pushToCopies: {
        useMutation: () => ({
          mutateAsync: vi.fn(async (args: typeof pushMutateArgs) => {
            pushMutateArgs = args;
            return { pushedTo: 2, selectedCopies: 2 };
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

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("PushToCopiesDialog (agents)", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    agentId: "agent-1",
    agentName: "My Agent",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pushMutateArgs = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders dialog title and description", async () => {
    render(<PushToCopiesDialog {...defaultProps} />, { wrapper: Wrapper });
    expect(screen.getByText("Push to Replicas")).toBeInTheDocument();
    expect(
      screen.getByText(/Select which replicas to push the latest config to/),
    ).toBeInTheDocument();
  });

  it("loads and displays replica list from getCopies", async () => {
    render(<PushToCopiesDialog {...defaultProps} />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText("Replica A")).toBeInTheDocument();
      expect(screen.getByText("Replica B")).toBeInTheDocument();
      expect(screen.getByText("Org / Team / Project A")).toBeInTheDocument();
      expect(screen.getByText("Org / Team / Project B")).toBeInTheDocument();
    });
  });

  it("Push button shows count and calls pushToCopies with selected copy ids", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PushToCopiesDialog {...defaultProps} onClose={onClose} />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Replica A")).toBeInTheDocument();
    });

    const pushBtn = screen.getByRole("button", { name: /Push to 2 replica/ });
    expect(pushBtn).not.toBeDisabled();
    await user.click(pushBtn);

    await waitFor(() => {
      expect(pushMutateArgs).not.toBeNull();
      expect(pushMutateArgs?.agentId).toBe("agent-1");
      expect(pushMutateArgs?.projectId).toBe("test-project-id");
      expect(pushMutateArgs?.copyIds).toEqual(["copy-1", "copy-2"]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("Cancel button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <PushToCopiesDialog {...defaultProps} onClose={onClose} />,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
