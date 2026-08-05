/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UseCaseStrip } from "../AutomationsEducation";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("UseCaseStrip", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given the alerts section is empty", () => {
    describe("when the error-spike card is clicked", () => {
      it("opens the drawer prefilled as a Slack alert", () => {
        const onOpen = vi.fn();
        render(<UseCaseStrip kind="alert" onOpen={onOpen} />, {
          wrapper: Wrapper,
        });

        fireEvent.click(screen.getByText("Error spike"));

        expect(onOpen).toHaveBeenCalledWith({
          initialSource: "customGraph",
          initialName: "Error spike alert",
          initialAction: "SEND_SLACK_MESSAGE",
        });
      });
    });

    describe("when the traffic-drop card is clicked", () => {
      it("opens the drawer prefilled as an email alert", () => {
        const onOpen = vi.fn();
        render(<UseCaseStrip kind="alert" onOpen={onOpen} />, {
          wrapper: Wrapper,
        });

        fireEvent.click(screen.getByText("Traffic drop"));

        expect(onOpen).toHaveBeenCalledWith({
          initialSource: "customGraph",
          initialName: "Traffic drop alert",
          initialAction: "SEND_EMAIL",
        });
      });
    });
  });

  describe("given the automations section is empty", () => {
    describe("when the dataset card is clicked", () => {
      it("opens the drawer prefilled as a trace automation", () => {
        const onOpen = vi.fn();
        render(<UseCaseStrip kind="automation" onOpen={onOpen} />, {
          wrapper: Wrapper,
        });

        fireEvent.click(screen.getByText("Build a dataset from errors"));

        expect(onOpen).toHaveBeenCalledWith({
          initialName: "Error dataset",
          initialAction: "ADD_TO_DATASET",
          initialFilters: JSON.stringify({ "traces.error": ["true"] }),
        });
      });
    });

    describe("when the annotation-queue card is clicked", () => {
      it("opens the drawer prefilled for annotators", () => {
        const onOpen = vi.fn();
        render(<UseCaseStrip kind="automation" onOpen={onOpen} />, {
          wrapper: Wrapper,
        });

        fireEvent.click(screen.getByText("Queue for review"));

        expect(onOpen).toHaveBeenCalledWith({
          initialName: "Review queue",
          initialAction: "ADD_TO_ANNOTATION_QUEUE",
          initialFilters: JSON.stringify({ "traces.error": ["true"] }),
        });
      });
    });
  });
});
