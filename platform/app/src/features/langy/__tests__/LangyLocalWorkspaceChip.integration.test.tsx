/**
 * @vitest-environment jsdom
 *
 * The panel header chip for a shared folder (ADR-129,
 * specs/langy/langy-local-control.feature). It is the standing answer to
 * "where is Langy working right now", so it says the folder, carries the
 * machine and the branch, and is the one place the share ends.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disconnectWorkspace = vi.fn();
let workspaceData: unknown = null;

vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      getLocalWorkspace: {
        useQuery: () => ({
          data: workspaceData,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      disconnectLocalWorkspace: {
        useMutation: () => ({ mutate: disconnectWorkspace, isPending: false }),
      },
    },
  },
}));

import { LangyLocalWorkspaceChip } from "../components/LangyLocalWorkspaceChip";

afterEach(cleanup);
beforeEach(() => disconnectWorkspace.mockClear());

const renderChip = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyLocalWorkspaceChip projectId="p_1" conversationId="c_1" />
    </ChakraProvider>,
  );

describe("given a connected folder", () => {
  beforeEach(() => {
    workspaceData = {
      connected: true,
      workspace: {
        root: "/Users/rogerio/Projects/acme-app",
        name: "acme-app",
        hostname: "rogerio-mbp",
        gitBranch: "main",
      },
    };
  });

  /** @scenario "A connected folder shows on the card and in the panel header" */
  it("names the folder, and carries the machine and the branch", () => {
    renderChip();

    expect(screen.getByText("acme-app connected")).toBeDefined();
    expect(
      screen.getByTestId("langy-workspace-chip").getAttribute("title"),
    ).toBe("/Users/rogerio/Projects/acme-app, on rogerio-mbp, branch main");
  });

  /** @scenario "Disconnecting from the panel revokes the key" */
  it("asks before it ends the share, then ends it", () => {
    renderChip();

    fireEvent.click(screen.getByTestId("langy-workspace-chip"));
    expect(
      screen.getByText(
        "Disconnect this folder? Langy stops working on your machine.",
      ),
    ).toBeDefined();
    expect(disconnectWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Disconnect"));
    expect(disconnectWorkspace).toHaveBeenCalledWith({
      projectId: "p_1",
      conversationId: "c_1",
    });
  });
});

describe("given no folder is connected", () => {
  beforeEach(() => {
    workspaceData = { connected: false, workspace: null };
  });

  it("renders nothing, so the header keeps its one line", () => {
    const { container } = renderChip();
    expect(container.textContent).toBe("");
  });
});
