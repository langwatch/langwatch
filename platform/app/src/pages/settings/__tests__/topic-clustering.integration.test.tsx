/**
 * @vitest-environment jsdom
 *
 * The topic clustering settings page shows guidance and a link to Model
 * Providers for a restricted-model failure.
 *
 * Spec: specs/topic-clustering/model-resolution.feature ("The settings page
 * shows guidance and a link for a restricted model failure")
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = Date.now();

vi.mock("~/utils/api", () => ({
  api: {
    topics: {
      getClusteringStatus: {
        useQuery: (
          _input?: unknown,
          _opts?: unknown,
        ) => ({
          isLoading: false,
          data: {
            lastRunOutcome: "failed",
            lastRunErrorCode: "model_restricted",
            isLastRunErrorUserActionable: true,
            isRunInFlight: false,
            lastRunAt: NOW - 60_000,
            lastRunSkippedReason: null,
            nextRunAt: null,
          },
        }),
      },
      getClusteringRunHistory: {
        useQuery: (
          _input?: unknown,
          _opts?: unknown,
        ) => ({
          isLoading: false,
          data: [
            {
              runId: "run_1",
              startedAt: NOW - 60_000,
              trigger: "manual",
              outcome: "failed",
              mode: null,
              skippedReason: null,
              errorCode: "model_restricted",
              isErrorUserActionable: true,
              tracesProcessed: 0,
              topicsCount: 0,
              subtopicsCount: 0,
            },
          ],
        }),
      },
    },
  },
}));

import { ClusteringStatusCard, RunHistoryCard } from "../topic-clustering";
import {
  MODEL_PROVIDERS_HREF,
  MODEL_PROVIDERS_LINK_LABEL,
} from "../topic-clustering-copy";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>
    <MemoryRouter>{children}</MemoryRouter>
  </ChakraProvider>
);

describe("topic clustering settings page", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a failed run with a restricted-model error", () => {
    /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
    it("shows the restricted-model guidance and a link to Model Providers on the status card", () => {
      render(
        <ClusteringStatusCard projectId="proj_1" lastTriggeredAt={null} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText(
          "The topic clustering model is not allowed for this feature",
        ),
      ).toBeInTheDocument();

      const link = screen.getByRole("link", {
        name: MODEL_PROVIDERS_LINK_LABEL,
      });
      expect(link).toHaveAttribute("href", MODEL_PROVIDERS_HREF);
    });

    /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
    it("shows a link to Model Providers on the run history row", () => {
      render(<RunHistoryCard projectId="proj_1" />, { wrapper: Wrapper });

      const link = screen.getByRole("link", {
        name: MODEL_PROVIDERS_LINK_LABEL,
      });
      expect(link).toHaveAttribute("href", MODEL_PROVIDERS_HREF);
    });
  });
});
