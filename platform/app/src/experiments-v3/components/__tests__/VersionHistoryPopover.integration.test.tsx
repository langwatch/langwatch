// @vitest-environment jsdom
/**
 * The workbench's version history, in the popover its header button anchors.
 *
 * Renders the real button and the real list against mocked tRPC boundaries:
 * the list it paints, the two-step restore, the permission that decides
 * whether the restore is offered at all, and the popover closing once a
 * restore lands.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
/** What the open workbench holds, which is what the current badge follows. */
let storeWorkbenchVersion: number | undefined = 12;
vi.mock("~/experiments-v3/hooks/useEvaluationsV3Store", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useEvaluationsV3Store: (selector: (state: any) => unknown) =>
    selector({
      experimentId: "exp_1",
      experimentSlug: "checkout",
      loadState: mockLoadState,
      setWorkbenchVersion: mockSetWorkbenchVersion,
      setStaleWorkbench: mockSetStaleWorkbench,
      workbenchVersion: storeWorkbenchVersion,
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

import { VersionHistoryButton } from "../VersionHistoryButton";

/**
 * A history as the seam writes one: two deliberate versions numbered without
 * gaps, and one autosave row that a long session of typing left behind. The
 * autosave carries a number of its own, but it is a handle for a restore and
 * not a place in the list, which is why the rows below run 2, autosave, 1.
 */
const versions = [
  {
    version: 2,
    counterVersion: 12,
    autoSaved: false,
    commitMessage: "Added a target",
    authorLabel: "langy",
    authorId: null,
    authorName: null,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    version: 11,
    counterVersion: 11,
    autoSaved: true,
    commitMessage: null,
    authorLabel: "user",
    authorId: "user_1",
    authorName: "Ada Lovelace",
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
  {
    version: 1,
    counterVersion: 1,
    autoSaved: false,
    commitMessage: "First setup",
    authorLabel: "user",
    authorId: "user_1",
    authorName: "Ada Lovelace",
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
  },
];

const historyTrigger = () =>
  screen.getByRole("button", { name: "Version history" });

/**
 * Render the header button and open its popover, which is what every case
 * below starts from: the history has no existence of its own any more.
 */
const openHistory = async () => {
  const user = userEvent.setup();
  render(
    <ChakraProvider value={defaultSystem}>
      <VersionHistoryButton />
    </ChakraProvider>,
  );
  await user.click(historyTrigger());
  await screen.findByTestId("version-history-popover");
  await waitFor(() => {
    expect(historyTrigger()).toHaveAttribute("aria-expanded", "true");
  });
  return user;
};

describe("VersionHistoryButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canRestore = true;
    storeWorkbenchVersion = 12;
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
    /** @scenario "The history opens on the button that asks for it" */
    it("opens on the button and closes on a second click", async () => {
      const user = await openHistory();

      expect(screen.getByTestId("version-history-popover")).toBeDefined();

      await user.click(historyTrigger());
      await waitFor(() => {
        expect(historyTrigger()).toHaveAttribute("aria-expanded", "false");
      });
    });

    /** @scenario "The version history names each version and who saved it" */
    it("renders a row per version naming its author", async () => {
      await openHistory();

      expect(await screen.findByText("v2")).toBeDefined();
      expect(screen.getByText("v1")).toBeDefined();
      expect(screen.getByText("· Langy")).toBeDefined();
      expect(screen.getAllByText("· Ada Lovelace")).toHaveLength(2);
      expect(screen.getByText(/Added a target/)).toBeDefined();
    });

    /** @scenario "The version history shows the autosave as an autosave" */
    it("ages the autosave row by its last write, not by its first", async () => {
      await openHistory();

      // The row is rewritten in place all session, so its createdAt is three
      // hours old while what it holds is five minutes old.
      await screen.findByText("Autosave");
      expect(screen.getByText(/5 minutes ago/)).toBeDefined();
      expect(screen.queryByText(/3 hours ago/)).toBeNull();
    });

    /** @scenario "The version history shows the autosave as an autosave" */
    it("names the autosave row rather than numbering it", async () => {
      await openHistory();

      expect(await screen.findByText("Autosave")).toBeDefined();
      // The autosave row carries version 11 as a restore handle. Showing it
      // would put a number in the list that its neighbours do not follow.
      expect(screen.queryByText("v11")).toBeNull();
    });

    /** @scenario "The current badge marks the version the workbench holds" */
    it("badges the version the workbench holds and offers no restore on it", async () => {
      await openHistory();

      // Which row carries it is the whole claim: the badge sits beside the
      // title, so the row it names has to be the one the workbench holds.
      const badge = await screen.findByText("Current");
      expect(badge.parentElement?.textContent).toContain("v2");
      // Two rows are older than the open workbench, and each of those can be
      // brought back. The one it already holds cannot.
      expect(screen.getAllByText("Restore")).toHaveLength(2);
    });

    describe("when the caller confirms a restore", () => {
      /** @scenario "Restoring a version reloads the workbench" */
      /** @scenario "The history closes once a restore lands" */
      it("restores it and loads the fresh setup into the workbench", async () => {
        const user = await openHistory();

        const [firstRestore] = await screen.findAllByText("Restore");
        await user.click(firstRestore!);
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
        // Chakra keeps the content mounted and marks it closed, so the
        // trigger's own state is what says the history went away.
        await waitFor(() => {
          expect(historyTrigger()).toHaveAttribute("aria-expanded", "false");
        });
      });
    });

    describe("when the caller only clicks Restore", () => {
      /** @scenario "A restore asks for confirmation first" */
      it("asks to confirm before restoring anything", async () => {
        const user = await openHistory();

        const [firstRestore] = await screen.findAllByText("Restore");
        await user.click(firstRestore!);

        expect(screen.getByText("Confirm restore")).toBeDefined();
        expect(mockRestore).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the workbench is behind the newest saved version", () => {
    it("badges the newest row, because that is the one the reader is shown", async () => {
      storeWorkbenchVersion = 3;
      await openHistory();

      const badge = await screen.findByText("Current");
      expect(badge.parentElement?.textContent).toContain("v2");
      expect(screen.getAllByText("Restore")).toHaveLength(2);
    });
  });

  describe("given the caller cannot update experiments", () => {
    /** @scenario "Restore is not offered without the permission" */
    it("offers no restore action", async () => {
      canRestore = false;
      await openHistory();

      expect(await screen.findByText("v2")).toBeDefined();
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
      await openHistory();

      expect(await screen.findByText("No versions saved yet.")).toBeDefined();
    });
  });
});
