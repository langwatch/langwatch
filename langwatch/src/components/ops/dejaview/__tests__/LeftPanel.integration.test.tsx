/**
 * @vitest-environment jsdom
 *
 * DejaView's left rail lists what processes an aggregate's events. It now shows
 * event subscribers rather than reactors — the raw-event consumers, keyed by
 * the event types they react to.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LeftPanel } from "../LeftPanel";

const projection = {
  projectionName: "traceSummary",
  pipelineName: "trace-processing",
  aggregateType: "trace",
};

const subscriber = {
  subscriberName: "graphTriggerActivity",
  pipelineName: "trace-processing",
  aggregateType: "trace",
  eventTypes: ["trace.received", "trace.updated"] as const,
};

const renderPanel = ({
  projections = [projection],
  eventSubscribers = [subscriber],
  selectedProjection = null as string | null,
  onSelectProjection = vi.fn(),
} = {}) => {
  render(
    <ChakraProvider value={defaultSystem}>
      <LeftPanel
        projections={projections}
        eventSubscribers={eventSubscribers}
        selectedProjection={selectedProjection}
        onSelectProjection={onSelectProjection}
        currentEventType={null}
      />
    </ChakraProvider>,
  );
  return { onSelectProjection };
};

afterEach(cleanup);

describe("LeftPanel", () => {
  describe("given an aggregate with subscribers", () => {
    describe("when the rail renders", () => {
      it("lists event subscribers, not reactors", () => {
        renderPanel();
        expect(screen.getByText("Event Subscribers")).toBeDefined();
        expect(screen.queryByText("Reactors")).toBeNull();
        expect(screen.getByText("graphTriggerActivity")).toBeDefined();
      });

      it("names the event types a subscriber reacts to", () => {
        renderPanel();
        expect(
          screen.getByText("on trace.received, trace.updated"),
        ).toBeDefined();
      });
    });
  });

  describe("given no subscribers for the aggregate type", () => {
    describe("when the rail renders", () => {
      it("says so instead of showing an empty section", () => {
        renderPanel({ eventSubscribers: [] });
        expect(
          screen.getByText("No event subscribers for this aggregate type."),
        ).toBeDefined();
      });
    });
  });

  describe("given a projection in the list", () => {
    describe("when it is clicked", () => {
      it("selects it", () => {
        const { onSelectProjection } = renderPanel();
        fireEvent.click(screen.getByText("traceSummary"));
        expect(onSelectProjection).toHaveBeenCalledWith("traceSummary");
      });
    });
  });
});
