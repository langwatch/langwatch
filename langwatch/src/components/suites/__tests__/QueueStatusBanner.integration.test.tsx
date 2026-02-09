/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueueStatusBanner } from "../QueueStatusBanner";

afterEach(cleanup);

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("<QueueStatusBanner/>", () => {
  describe("when there are pending and active jobs", () => {
    it("displays only the pending count", () => {
      renderWithChakra(
        <QueueStatusBanner queueStatus={{ waiting: 2, active: 1 }} />,
      );

      expect(screen.getByText(/2 scenarios pending/)).toBeTruthy();
      expect(screen.queryByText(/running/)).toBeNull();
    });

    it("renders a spinner", () => {
      renderWithChakra(
        <QueueStatusBanner queueStatus={{ waiting: 2, active: 1 }} />,
      );

      expect(screen.getByTestId("queue-status-spinner")).toBeTruthy();
    });
  });

  describe("when there are only pending jobs", () => {
    it("displays the pending count", () => {
      renderWithChakra(
        <QueueStatusBanner queueStatus={{ waiting: 5, active: 0 }} />,
      );

      expect(screen.getByText(/5 scenarios pending/)).toBeTruthy();
      expect(screen.queryByText(/running/)).toBeNull();
    });
  });

  describe("when there are only active jobs", () => {
    it("renders nothing because active jobs appear in the run history list", () => {
      const { container } = renderWithChakra(
        <QueueStatusBanner queueStatus={{ waiting: 0, active: 3 }} />,
      );

      expect(container.textContent).toBe("");
    });
  });

  describe("when there are no pending or active jobs", () => {
    it("renders nothing", () => {
      const { container } = renderWithChakra(
        <QueueStatusBanner queueStatus={{ waiting: 0, active: 0 }} />,
      );

      expect(container.textContent).toBe("");
    });
  });

  describe("when queueStatus is undefined", () => {
    it("renders nothing", () => {
      const { container } = renderWithChakra(
        <QueueStatusBanner queueStatus={undefined} />,
      );

      expect(container.textContent).toBe("");
    });
  });
});
