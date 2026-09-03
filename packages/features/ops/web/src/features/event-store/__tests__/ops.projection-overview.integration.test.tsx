/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectionsCard } from "../ui/elements/projections-card";
import { ReplayHistorySection } from "../ui/blocks/replay-history-section";

const renderWithChakra = (ui: React.ReactElement) =>
  render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);

afterEach(cleanup);

describe("projection overview presentation", () => {
  it("renders the registered projection health rows and their live status", () => {
    renderWithChakra(
      <ProjectionsCard
        rows={[
          {
            projectionName: "invoice",
            pipelineName: "billing",
            aggregateType: "account",
            kind: "fold",
            pending: 3,
            active: 1,
            blocked: 0,
            hasLiveNode: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("invoice")).toBeTruthy();
    expect(screen.getByText("billing")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("reports an empty projection registry", () => {
    renderWithChakra(<ProjectionsCard rows={[]} />);

    expect(screen.getByText("No projections registered.")).toBeTruthy();
  });

  it("keeps replay navigation in the app render port", () => {
    const onOpenReplay = vi.fn();
    renderWithChakra(
      <ReplayHistorySection
        latestEntry={{
          runId: "run_1",
          description: "Nightly rebuild",
          startedAt: "2026-08-26T10:00:00.000Z",
          completedAt: "2026-08-26T10:01:00.000Z",
          state: "completed",
        }}
        onOpenReplay={onOpenReplay}
        renderRunLink={(runId, content) => <span data-testid={`run-link-${runId}`}>{content}</span>}
      />,
    );

    expect(screen.getByText("Nightly rebuild")).toBeTruthy();
    expect(screen.getByTestId("run-link-run_1")).toBeTruthy();
    fireEvent.click(screen.getByText("Latest Replay"));
    expect(onOpenReplay).toHaveBeenCalledTimes(1);
  });
});
