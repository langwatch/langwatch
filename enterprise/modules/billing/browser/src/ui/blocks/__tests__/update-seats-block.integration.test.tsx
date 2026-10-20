/**
 * @vitest-environment jsdom
 * The seat-change summary card: its price, its two actions and its pending state.
 */
import "@testing-library/jest-dom/vitest";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpdateSeatsBlock } from "../update-seats-block.tsx";

afterEach(cleanup);

function renderBlock(props: { isLoading?: boolean } = {}) {
  const onUpdate = vi.fn();
  const onDiscard = vi.fn();
  render(
    <UpdateSeatsBlock
      totalFullMembers={3}
      totalPrice="€60"
      monthlyEquivalent="€20"
      onUpdate={onUpdate}
      onDiscard={onDiscard}
      {...props}
    />,
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
      ),
    },
  );
  return { onUpdate, onDiscard };
}

describe("UpdateSeatsBlock", () => {
  it("is an ordinary panel inset 24px across and 20px down", () => {
    renderBlock();

    const block = screen.getByTestId("update-seats-block");
    expect(block.dataset).toMatchObject({ cardVariant: "panel", cardPadding: "inline-lg" });
    expect(screen.getByText("Update seats")).toBeInTheDocument();
  });

  it("runs Discard and Update subscription", () => {
    const { onUpdate, onDiscard } = renderBlock();

    fireEvent.click(screen.getByTestId("discard-seat-changes-button"));
    fireEvent.click(screen.getByRole("button", { name: "Update subscription" }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("holds both actions while the update is in flight", () => {
    const { onUpdate, onDiscard } = renderBlock({ isLoading: true });

    expect(screen.getByTestId("discard-seat-changes-button")).toBeDisabled();
    fireEvent.click(screen.getByTestId("discard-seat-changes-button"));
    fireEvent.click(screen.getByRole("button", { name: /Update subscription/ }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
