/**
 * @vitest-environment jsdom
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RetroactiveProgressCard } from "../retroactive-progress-card.tsx";

describe("RetroactiveProgressCard", () => {
  afterEach(cleanup);

  describe("given two updates in one category and one without a category", () => {
    describe("when each Cancel is clicked", () => {
      it("cancels the update with its original identifier", () => {
        const onCancel = vi.fn();
        render(
          <DesignSystemProvider forcedTheme="light">
            <RetroactiveProgressCard
              isCancelling={false}
              onCancel={onCancel}
              mutations={[
                { mutationId: "m1", table: "t1", category: "traces", partsToDo: 3 },
                { mutationId: "m2", table: "t2", category: "traces", partsToDo: 1 },
                { mutationId: "m3", table: "t3", category: null, partsToDo: 2 },
              ]}
            />
          </DesignSystemProvider>,
        );
        expect(screen.getByText("Update 1")).toBeTruthy();
        expect(screen.getByText("Update 2")).toBeTruthy();
        expect(screen.getByText("Stored data")).toBeTruthy();
        const buttons = screen.getAllByRole("button", { name: "Cancel" });
        buttons.forEach((b) => fireEvent.click(b));
        expect(onCancel.mock.calls.map((c) => c[0])).toEqual(["m1", "m2", "m3"]);
      });
    });
  });

  describe("given an apply in flight at 40 percent", () => {
    /** @scenario "The panel shows an apply in flight with its percentage and Cancel" */
    it("shows the percentage with a Cancel action", () => {
      const onCancel = vi.fn();
      render(
        <DesignSystemProvider forcedTheme="light">
          <RetroactiveProgressCard
            isCancelling={false}
            onCancel={onCancel}
            mutations={[
              {
                mutationId: "m1",
                table: "stored_spans",
                category: "traces",
                partsToDo: 3,
                progressPercent: 40,
              },
            ]}
          />
        </DesignSystemProvider>,
      );
      expect(screen.getByText("Applying… 40%")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledWith("m1");
    });
  });

  describe("given an apply the worker gave up on", () => {
    /** @scenario "The panel shows a failed apply with its message and Dismiss" */
    it("shows the failure message with a Dismiss action", () => {
      const onCancel = vi.fn();
      render(
        <DesignSystemProvider forcedTheme="light">
          <RetroactiveProgressCard
            isCancelling={false}
            onCancel={onCancel}
            mutations={[
              {
                mutationId: "failed:r1",
                table: "",
                category: "traces",
                partsToDo: 0,
                failure: "Applying this retention change to existing data failed.",
              },
            ]}
          />
        </DesignSystemProvider>,
      );
      expect(screen.getByText("Failed")).toBeTruthy();
      expect(
        screen.getByText("Applying this retention change to existing data failed."),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(onCancel).toHaveBeenCalledWith("failed:r1");
    });
  });
});
