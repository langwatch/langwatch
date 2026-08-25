// @vitest-environment jsdom
/**
 * The workbench's version-history drawer.
 *
 * Renders the real component against mocked tRPC boundaries: the list it
 * paints, the two-step restore, and the permission that decides whether the
 * restore is offered at all.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCloseDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: mockCloseDrawer, openDrawer: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "acme" },
  }),
}));

let canRestore = true;
vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({
    can: (permission: string) =>
      permission === "experiments:update" ? canRestore : true,
    isLoading: false,
    permissions: [],
  }),
}));

const mockLoadState = vi.fn();
const mockSetWorkbenchVersion = vi.fn();
const mockSetStaleWorkbench = vi.fn();
vi.mock("~/experiments-v3/hooks/useEvaluationsV3Store", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useEvaluationsV3Store: (selector: (state: any) => unknown) =>
    selector({
      loadState: mockLoadState,
      setWorkbenchVersion: mockSetWorkbenchVersion,
      setStaleWorkbench: mockSetStaleWorkbench,
    }),
}));

const mockToast = vi.fn();
vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => mockToast(...args) },
}));

const mockErrorToast = vi.fn();
vi.mock("~/features/errors", () => ({
  showErrorToast: (...args: unknown[]) => mockErrorToast(...args),
}));

const mockRestore = vi.fn();
const mockVersionsInvalidate = vi.fn();
const mockStateInvalidate = vi.fn();
const mockStateFetch = vi.fn();
let versionsQuery: {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      listWorkbenchVersions: { useQuery: () => versionsQuery },
      restoreWorkbenchVersion: {
        useMutation: () => ({ mutateAsync: mockRestore }),
      },
    },
    useUtils: () => ({
      experiments: {
        listWorkbenchVersions: { invalidate: mockVersionsInvalidate },
        getEvaluationsV3BySlug: {
          invalidate: mockStateInvalidate,
          fetch: mockStateFetch,
        },
      },
    }),
  },
}));

import { VersionHistoryDrawer } from "../VersionHistoryDrawer";

const versions = [
  {
    version: 12,
    autoSaved: false,
    commitMessage: "Added a target",
    authorLabel: "langy",
    authorId: null,
    authorName: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    version: 11,
    autoSaved: true,
    commitMessage: null,
    authorLabel: "user",
    authorId: "user_1",
    authorName: "Ada Lovelace",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
];

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <VersionHistoryDrawer experimentId="exp_1" experimentSlug="checkout" />
    </ChakraProvider>,
  );

describe("VersionHistoryDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canRestore = true;
    versionsQuery = {
      data: { versions, nextCursor: null },
      isLoading: false,
      isError: false,
    };
    mockRestore.mockResolvedValue({ version: 13 });
    mockStateFetch.mockResolvedValue({
      workbenchState: { name: "Restored setup" },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the experiment has versions", () => {
    /** @scenario "The version history names each version and who saved it" */
    it("renders a row per version naming its author", async () => {
      renderDrawer();

      expect(await screen.findByText("v12")).toBeDefined();
      expect(screen.getByText("· Langy")).toBeDefined();
      expect(screen.getByText("· Ada Lovelace")).toBeDefined();
      expect(screen.getByText(/Added a target/)).toBeDefined();
    });

    describe("when the caller confirms a restore", () => {
      /** @scenario "Restoring a version reloads the workbench" */
      it("restores it and loads the fresh setup into the workbench", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.click(await screen.findByText("Restore"));
        await user.click(await screen.findByText("Confirm restore"));

        await waitFor(() => {
          expect(mockRestore).toHaveBeenCalledWith({
            projectId: "project_1",
            experimentId: "exp_1",
            version: 11,
          });
        });
        await waitFor(() => {
          expect(mockLoadState).toHaveBeenCalledWith({
            name: "Restored setup",
          });
        });
        expect(mockStateInvalidate).toHaveBeenCalled();
        expect(mockVersionsInvalidate).toHaveBeenCalled();
        expect(mockCloseDrawer).toHaveBeenCalled();
      });
    });

    describe("when the caller only clicks Restore", () => {
      /** @scenario "A restore asks for confirmation first" */
      it("asks to confirm before restoring anything", async () => {
        const user = userEvent.setup();
        renderDrawer();

        await user.click(await screen.findByText("Restore"));

        expect(screen.getByText("Confirm restore")).toBeDefined();
        expect(mockRestore).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the caller cannot update experiments", () => {
    /** @scenario "Restore is not offered without the permission" */
    it("offers no restore action", async () => {
      canRestore = false;
      renderDrawer();

      expect(await screen.findByText("v12")).toBeDefined();
      expect(screen.queryByText("Restore")).toBeNull();
    });
  });

  describe("given the experiment has no versions", () => {
    it("shows the empty state", async () => {
      versionsQuery = {
        data: { versions: [], nextCursor: null },
        isLoading: false,
        isError: false,
      };
      renderDrawer();

      expect(await screen.findByText("No versions saved yet.")).toBeDefined();
    });
  });
});
