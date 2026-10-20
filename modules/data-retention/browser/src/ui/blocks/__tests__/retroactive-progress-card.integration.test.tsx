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
});
