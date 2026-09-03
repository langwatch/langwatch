// @vitest-environment jsdom
/**
 * One failure, one surface.
 *
 * A save can be refused by something the application has ALREADY put on the
 * reader's screen — a lite-member restriction rendered as a modal, a plan limit
 * — and a drawer that toasts on top of that stacks two accounts of one refusal.
 * `isReportedGlobally` is the host's answer to "have you shown this already",
 * and it is asked before anything is raised here.
 *
 * PORTED WITH THE DRAWER from
 * `platform/app/src/components/settings/__tests__/LLMModelCostDrawer.lite-member.integration.test.tsx`,
 * whose subject was deleted in `cc91631cd8`. Three mocks that named platform
 * modules are gone: the tenant and both feedback paths are the host port now,
 * so the fake host records what the drawer asked the application to do, and the
 * assertions read that instead of a toaster spy. `isHandledByGlobalHandler` was
 * a `~/utils/trpcError` module; it is `host.isReportedGlobally` here.
 *
 * @see specs/settings/llm-model-cost-drawer-error-handling.feature
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOrUpdateMutate, mockMutationError, mockCosts, mockCloseDrawer } = vi.hoisted(
  () => ({
    mockCreateOrUpdateMutate: vi.fn(),
    mockMutationError: { current: null as Error | null },
    mockCloseDrawer: vi.fn(),
    mockCosts: {
      current: [
        {
          id: "cost-1",
          model: "gpt-4",
          regex: "gpt-4.*",
          inputCostPerToken: 0.00003,
          outputCostPerToken: 0.00006,
          cacheReadCostPerToken: null,
          cacheCreationCostPerToken: null,
          cacheCreation1hCostPerToken: null,
          projectId: "proj-1",
          updatedAt: new Date(),
        },
      ] as Array<Record<string, unknown>>,
    },
  }),
);

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({ closeDrawer: mockCloseDrawer }),
}));

vi.mock("../../../behavior/model-provider-api", () => ({
  modelProviderApi: {
    useUtils: () => ({ modelProvider: { invalidate: vi.fn() } }),
    llmModelCost: {
      getAllForProject: {
        useQuery: () => ({
          data: mockCosts.current,
          isLoading: false,
          refetch: vi.fn(),
        }),
      },
      createOrUpdate: {
        useMutation: () => ({
          mutate: (data: unknown, options: { onError?: (error: unknown) => void }) => {
            mockCreateOrUpdateMutate(data, options);
            if (mockMutationError.current) options.onError?.(mockMutationError.current);
          },
          isPending: false,
        }),
      },
      previewMatchingSpans: {
        useQuery: () => ({
          data: {
            windowDays: 7,
            totalMatchedSpans: 0,
            matchedModels: [],
            sampleSpans: [],
            unmatchedModels: [],
          },
          isLoading: false,
        }),
      },
    },
  },
}));

import { LLMModelCostDrawer } from "../llm-model-cost-drawer";
import { FakeModelProviderHost, renderWithModelProviderHost } from "../../../testing";

const REPORTED = new Error("Lite member restricted");

/** A host that says the application has already shown exactly one failure. */
class HostThatAlreadyReported extends FakeModelProviderHost {
  override isReportedGlobally(error: unknown): boolean {
    return error === REPORTED;
  }
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mockCreateOrUpdateMutate).toHaveBeenCalledTimes(1));
}

describe("given the LLM model cost drawer's save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutationError.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the refusal was already put on screen by the application", () => {
    /** @scenario "LLM model cost drawer skips the generic error toast after a primary error UI is shown" */
    it("says nothing more about it", async () => {
      mockMutationError.current = REPORTED;
      const host = new HostThatAlreadyReported();

      renderWithModelProviderHost(<LLMModelCostDrawer id="cost-1" />, host);
      await submit();

      expect(host.failures).toEqual([]);
    });
  });

  describe("when nothing has reported the refusal yet", () => {
    /** @scenario "LLM model cost drawer shows the generic error toast when no primary error UI is shown" */
    it("reports it, naming the action rather than quoting the failure", async () => {
      mockMutationError.current = new Error("Network error");
      const host = new FakeModelProviderHost();

      renderWithModelProviderHost(<LLMModelCostDrawer id="cost-1" />, host);
      await submit();

      expect(host.failures).toHaveLength(1);
      expect(host.failures[0]?.fallbackTitle).toBe("Couldn't update model cost");
      // The raw message never becomes the copy: the words a customer reads are
      // resolved by the application from the error's own code, so what travels
      // is the error itself and a title naming what was being attempted.
      expect(host.failures[0]?.error).toBe(mockMutationError.current);
    });
  });
});
