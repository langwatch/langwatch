// @vitest-environment jsdom

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AutomationUseCaseStrip } from "../ui/elements/automation-use-case-strip.tsx";

describe("AutomationUseCaseStrip", () => {
  it("opens alert cards with the existing graph and delivery prefills", () => {
    const onOpen = vi.fn();
    renderWithDesignSystem(<AutomationUseCaseStrip kind="alert" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Error spike" }));

    expect(onOpen).toHaveBeenCalledWith({
      initialSource: "customGraph",
      initialName: "Error spike",
      initialAction: "SEND_SLACK_MESSAGE",
    });

    fireEvent.click(screen.getByRole("button", { name: "Traffic drop" }));

    expect(onOpen).toHaveBeenLastCalledWith({
      initialSource: "customGraph",
      initialName: "Traffic drop",
      initialAction: "SEND_EMAIL",
    });
  });

  it("opens trace cards with their existing action and filter prefills", () => {
    const onOpen = vi.fn();
    renderWithDesignSystem(<AutomationUseCaseStrip kind="automation" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Build a dataset from errors" }));

    expect(onOpen).toHaveBeenCalledWith({
      initialName: "Error dataset",
      initialAction: "ADD_TO_DATASET",
      initialFilters: JSON.stringify({ "traces.error": ["true"] }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Queue for review" }));

    expect(onOpen).toHaveBeenLastCalledWith({
      initialName: "Review queue",
      initialAction: "ADD_TO_ANNOTATION_QUEUE",
      initialFilters: JSON.stringify({ "traces.error": ["true"] }),
    });
  });
});
