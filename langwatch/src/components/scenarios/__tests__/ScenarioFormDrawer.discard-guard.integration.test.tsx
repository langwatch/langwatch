/**
 * @vitest-environment jsdom
 *
 * Closing the scenario editor when there is something to lose.
 *
 * A new scenario lives only in the form until the first save — no record to
 * return to, no draft to recover — so a stray Escape or a mis-aimed Cancel is
 * unrecoverable. The interesting case is the AI-drafted one: the draft arrives
 * as the form's own defaults, so react-hook-form reports it pristine while
 * closing on it still throws away a generated scenario.
 *
 * Boundary mocks only: tRPC, the drawer router, and the heavy sibling drawers.
 * The form, the dirtiness tracking and the confirm dialog are all real.
 *
 * @see specs/scenarios/scenario-editor-discard-guard.feature
 */
import * as React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prompts/PromptEditorDrawer", () => ({
  PromptEditorDrawer: () => null,
}));
vi.mock("../../agents/AgentTypeSelectorDrawer", () => ({
  AgentTypeSelectorDrawer: () => null,
}));
vi.mock("../ScenarioEditorSidebar", () => ({
  ScenarioEditorSidebar: () => null,
}));
vi.mock("../ScenarioRunModelDialog", () => ({
  ScenarioRunModelDialog: () => null,
}));
vi.mock("../SaveAndRunMenu", () => ({
  SaveAndRunMenu: ({
    onSaveWithoutRunning,
  }: {
    onSaveWithoutRunning?: () => void;
  }) => (
    <button data-testid="save-button" onClick={onSaveWithoutRunning}>
      Save
    </button>
  ),
}));

import { ScenarioFormDrawer } from "../ScenarioFormDrawer";

const mocks = vi.hoisted(() => ({
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockCloseDrawer: vi.fn(),
  mockGetByIdData: null as {
    id: string;
    name: string;
    situation: string;
    criteria: string[];
    labels: string[];
  } | null,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: ({ onSuccess }: { onSuccess?: (data: unknown) => void }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            const result = await mocks.mockCreateMutateAsync(input);
            onSuccess?.(result);
            return result;
          }),
          isPending: false,
        }),
      },
      update: {
        useMutation: ({ onSuccess }: { onSuccess?: (data: unknown) => void }) => ({
          mutateAsync: vi.fn(async (input: unknown) => {
            const result = await mocks.mockUpdateMutateAsync(input);
            onSuccess?.(result);
            return result;
          }),
          isPending: false,
        }),
      },
      getById: {
        useQuery: () => ({ data: mocks.mockGetByIdData, isLoading: false }),
      },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    licenseEnforcement: {
      checkLimit: {
        useQuery: () => ({
          data: { allowed: true, current: 0, max: 100 },
          isLoading: false,
        }),
      },
      reportLimitBlocked: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useContext: () => ({
      scenarios: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
      agents: { getById: { fetch: vi.fn() } },
    }),
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    closeDrawer: mocks.mockCloseDrawer,
    drawerOpen: vi.fn(() => true),
    goBack: vi.fn(),
    canGoBack: false,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-123", slug: "my-project" },
    organization: { id: "org-123" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "my-project" },
    pathname: "/[project]/simulations/scenarios",
    asPath: "/my-project/simulations/scenarios",
    push: vi.fn(),
    replace: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useRunScenario", () => ({
  useRunScenario: () => ({ runScenario: vi.fn(), isRunning: false }),
}));

vi.mock("~/hooks/useScenarioTarget", () => ({
  useScenarioTarget: () => ({
    target: null,
    setTarget: vi.fn(),
    clearTarget: vi.fn(),
    hasPersistedTarget: false,
  }),
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: unknown) => {
    if (typeof selector === "function") {
      return (selector as (state: { open: () => void }) => unknown)({
        open: vi.fn(),
      });
    }
    return { open: vi.fn() };
  },
}));

vi.mock("../../ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const SAVED_SCENARIO = {
  id: "existing-scenario-id",
  name: "Refund Flow",
  situation: "A customer was charged twice",
  criteria: ["Agent apologises"],
  labels: ["billing"],
};

const discardQuestion = () =>
  screen.queryByText(/Discard (this scenario|your changes)\?/);

const clickCancel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Cancel" }));
};

describe("closing the scenario editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockGetByIdData = null;
    mocks.mockCreateMutateAsync.mockResolvedValue({
      ...SAVED_SCENARIO,
      id: "new-scenario-id",
    });
    mocks.mockUpdateMutateAsync.mockResolvedValue(SAVED_SCENARIO);
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a new scenario nobody has typed into", () => {
    /** @scenario An untouched new scenario closes without a question */
    it("closes straight away", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ScenarioFormDrawer open={true} onClose={onClose} />, {
        wrapper: Wrapper,
      });

      await clickCancel(user);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(discardQuestion()).not.toBeInTheDocument();
    });
  });

  describe("given a new scenario with a name typed into it", () => {
    const renderTyped = async (onClose: () => void) => {
      const user = userEvent.setup();
      render(<ScenarioFormDrawer open={true} onClose={onClose} />, {
        wrapper: Wrapper,
      });
      await user.type(
        screen.getByPlaceholderText("e.g., Angry refund request"),
        "Angry customer",
      );
      return user;
    };

    /** @scenario A scenario I have typed into asks before closing */
    it("asks before closing, and does not close yet", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);

      await clickCancel(user);

      expect(await screen.findByText("Discard this scenario?")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    /** @scenario Cancel is guarded like every other close */
    it("guards the Cancel button, not just the corner close", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);

      await clickCancel(user);

      expect(await screen.findByText("Discard this scenario?")).toBeInTheDocument();
    });

    /** @scenario Keeping the work returns me to the editor with it intact */
    it("keeps the typed name when I choose to keep editing", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);
      await clickCancel(user);
      await screen.findByText("Discard this scenario?");

      await user.click(screen.getByRole("button", { name: "Keep editing" }));

      await waitFor(() => expect(discardQuestion()).not.toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue("Angry customer")).toBeInTheDocument();
    });

    /** @scenario Discarding closes the editor */
    it("closes when I choose to discard", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);
      await clickCancel(user);
      await screen.findByText("Discard this scenario?");

      await user.click(screen.getByRole("button", { name: "Discard" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    /** @scenario Discarding never saves the scenario */
    it("saves nothing on the way out", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);
      await clickCancel(user);
      await screen.findByText("Discard this scenario?");

      await user.click(screen.getByRole("button", { name: "Discard" }));

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(mocks.mockCreateMutateAsync).not.toHaveBeenCalled();
    });

    /** @scenario A successful save closes without asking */
    it("does not ask once the work has been saved", async () => {
      const onClose = vi.fn();
      const user = await renderTyped(onClose);

      await user.click(screen.getByTestId("save-button"));

      await waitFor(() =>
        expect(mocks.mockCreateMutateAsync).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(discardQuestion()).not.toBeInTheDocument();
    });
  });

  describe("given a new scenario the assistant drafted and nobody edited", () => {
    // The draft is the form's defaults, so react-hook-form calls it pristine.
    /** @scenario An AI-drafted scenario I have not edited still asks */
    it("still asks before throwing the draft away", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(
        <ScenarioFormDrawer
          open={true}
          onClose={onClose}
          initialFormData={{
            name: "Double charge refund",
            situation: "A premium subscriber was charged twice",
            criteria: ["Agent apologises"],
            labels: [],
          }}
        />,
        { wrapper: Wrapper },
      );
      await screen.findByDisplayValue("Double charge refund");

      await clickCancel(user);

      expect(await screen.findByText("Discard this scenario?")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe("given a saved scenario open for editing", () => {
    beforeEach(() => {
      mocks.mockGetByIdData = SAVED_SCENARIO;
    });

    /** @scenario An existing scenario I have only read closes without a question */
    it("closes straight away when nothing was changed", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ScenarioFormDrawer open={true} onClose={onClose} />, {
        wrapper: Wrapper,
      });
      await screen.findByDisplayValue("Refund Flow");

      await clickCancel(user);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(discardQuestion()).not.toBeInTheDocument();
    });

    /** @scenario An existing scenario I have edited asks before closing */
    it("asks about the changes, naming them rather than the scenario", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<ScenarioFormDrawer open={true} onClose={onClose} />, {
        wrapper: Wrapper,
      });
      const situation = await screen.findByDisplayValue(
        "A customer was charged twice",
      );
      await user.type(situation, " and wants it back");

      await clickCancel(user);

      // "your changes", not "this scenario": the scenario itself survives.
      expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
