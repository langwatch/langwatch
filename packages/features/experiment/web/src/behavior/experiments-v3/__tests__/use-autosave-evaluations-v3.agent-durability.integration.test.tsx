/**
 * @vitest-environment jsdom
 *
 * An agent's edit has to be on the server before the agent is told it worked.
 *
 * The agent reads a successful UI action as "the document now says this", and
 * its next step is a server-side one that reads the SAVED document. On the
 * ordinary 1.5s autosave debounce, a duplicated column lived only in the tab
 * that ran it: the run that followed computed from a document without it, the
 * results write came back as a newer version, and the pending save was then
 * refused as out of date. The column could never be saved after that.
 *
 * @see specs/langy/langy-ui-actions.feature
 *   ("An action the browser ran is saved before the agent is told it worked")
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../use-evaluations-v3-store";

const AUTOSAVE_DEBOUNCE_MS = 1500;

const mockMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/workflow-web/studio-host/api", () => ({
  api: {
    useUtils: () => ({
      experiments: {
        getEvaluationsV3BySlug: {
          invalidate: vi.fn(),
          reset: vi.fn(),
          fetch: vi.fn(),
        },
      },
    }),
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
      getEvaluationsV3BySlug: {
        useQuery: () => ({ data: null, isLoading: false }),
      },
    },
  },
}));

vi.mock("@langwatch/workflow-web/studio-host/next-router", () => ({
  useRouter: () => ({
    query: { slug: "test-slug" },
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("@langwatch/workflow-web/studio-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
  }),
}));

vi.mock("@langwatch/workflow-web/studio-host/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../../../model/posthog-error-capture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

import {
  type AutosaveOutcome,
  useAutosaveEvaluationsV3,
} from "../use-autosave-evaluations-v3";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
  </QueryClientProvider>
);

let autosave: ReturnType<typeof useAutosaveEvaluationsV3> | null = null;
const TestComponent = () => {
  autosave = useAutosaveEvaluationsV3();
  return <div>autosave</div>;
};

/** The change an agent's `workbench.duplicateTarget` leaves in the store. */
const applyAgentEdit = () => {
  act(() => {
    useEvaluationsV3Store
      .getState()
      .setCellValue("test-data", 0, "input", "the agent's edit");
  });
};

describe("an agent edit reaching the server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autosave = null;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.clear();
    mockMutateAsync.mockResolvedValue({
      id: "test-experiment-id",
      slug: "test-slug",
      name: "New Evaluation",
      version: 7,
    });
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({
      experimentSlug: "test-slug",
      experimentId: "test-experiment-id",
      workbenchVersion: 6,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe("when the handler asks for the save before answering", () => {
    /** @scenario An agent edit is on the server before the action reports success */
    it("has already saved by the time the call resolves, without the debounce", async () => {
      render(<TestComponent />, { wrapper: Wrapper });
      applyAgentEdit();

      // Deliberately no timer advance: the debounce has not fired, so if the
      // save only happened on the timer this would still be zero.
      await act(async () => {
        await autosave?.saveNow();
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          experimentId: "test-experiment-id",
          expectedVersion: 6,
        }),
      );
    });

    /** @scenario An agent edit is on the server before the action reports success */
    it("leaves the page holding the version the save returned", async () => {
      render(<TestComponent />, { wrapper: Wrapper });
      applyAgentEdit();

      await act(async () => {
        await autosave?.saveNow();
      });

      expect(useEvaluationsV3Store.getState().workbenchVersion).toBe(7);
    });

    /** @scenario An agent edit is on the server before the action reports success */
    it("does not save the same state twice when the debounce follows", async () => {
      render(<TestComponent />, { wrapper: Wrapper });
      applyAgentEdit();

      await act(async () => {
        await autosave?.saveNow();
      });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 100);
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe("when two saves are asked for at once", () => {
    /** @scenario Two saves never overlap */
    it("sends the second only after the first, on the version the first returned", async () => {
      let release: (() => void) | null = null;
      mockMutateAsync.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          id: "test-experiment-id",
          slug: "test-slug",
          name: "New Evaluation",
          version: 7,
        };
      });

      render(<TestComponent />, { wrapper: Wrapper });
      applyAgentEdit();

      let first: Promise<AutosaveOutcome> | undefined;
      let second: Promise<AutosaveOutcome> | undefined;
      // A chained save starts on a microtask, so the queue is drained before
      // asserting that the first one is the only one out.
      await act(async () => {
        first = autosave?.saveNow();
        await Promise.resolve();
      });
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);

      // The second edit and the second save both land while the first is in
      // flight, which is exactly the overlap that used to send two writes on
      // the same expectedVersion.
      await act(async () => {
        useEvaluationsV3Store
          .getState()
          .setCellValue("test-data", 1, "input", "a second edit");
        second = autosave?.saveNow();
        await Promise.resolve();
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(1);

      await act(async () => {
        release?.();
        await first;
        await second;
      });

      expect(mockMutateAsync).toHaveBeenCalledTimes(2);
      expect(mockMutateAsync.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ expectedVersion: 7 }),
      );
    });
  });
});
