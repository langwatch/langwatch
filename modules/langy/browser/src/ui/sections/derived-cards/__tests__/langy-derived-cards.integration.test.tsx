/** @vitest-environment jsdom */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { LangyDerivedCard, LangyDerivedChoicesCard } from "@langwatch/langy-contract";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LangyFailedCard } from "../../../elements/derived-cards/langy-failed-card.tsx";
import { LangyChoicesCard } from "../langy-choices-card.tsx";
import { LangyDerivedCardView } from "../langy-derived-card-view.tsx";

afterEach(cleanup);

function renderCard(card: LangyDerivedCard) {
  return render(
    <DesignSystemProvider forcedTheme="light">
      <LangyDerivedCardView card={card} />
    </DesignSystemProvider>,
  );
}

describe("Langy derived card presentation", () => {
  it("renders a bounded table and reports omitted rows", () => {
    const rows = Array.from({ length: 31 }, (_, index) => [`row-${index}`]);

    renderCard({
      kind: "table",
      blockId: "table-1",
      title: "Recent failures",
      columns: ["name"],
      rows,
    });

    expect(screen.getByText("row-0")).toBeDefined();
    expect(screen.getByText("row-29")).toBeDefined();
    expect(screen.queryByText("row-30")).toBeNull();
    expect(screen.getByText("+1 more rows in the reply")).toBeDefined();
  });

  /** @scenario "A grounded option still reads as the answer it is" */
  it("reads a grounded option as its own label with the resource's name as detail", () => {
    const card: LangyDerivedChoicesCard = {
      kind: "choices",
      blockId: "q-publish",
      question: "Publish the winner?",
      options: [
        {
          id: "publish",
          label: "Publish the winning draft",
          ref: { type: "prompt", id: "prompt_1" },
        },
      ],
    };

    render(
      <DesignSystemProvider forcedTheme="light">
        <LangyChoicesCard
          card={card}
          lockState={{ status: "open" }}
          onSelect={vi.fn()}
          refRows={
            new Map([
              ["publish", { state: "live", primary: "support-reply-v1", secondary: "version 3" }],
            ])
          }
        />
      </DesignSystemProvider>,
    );

    expect(screen.getByText("Publish the winning draft")).toBeDefined();
    expect(screen.getByText("support-reply-v1 · version 3")).toBeDefined();
  });

  /** @scenario Picking a quiet option answers the question */
  it("answers with a quiet option's id and locks the card with that option marked", () => {
    const onSelect = vi.fn();
    const card: LangyDerivedChoicesCard = {
      kind: "choices",
      blockId: "choice-quiet",
      question: "How should I set this up?",
      options: [
        { id: "folder", label: "Share a local folder" },
        { id: "describe", label: "I'd rather describe it", quiet: true },
      ],
    };
    const view = (lockState: Parameters<typeof LangyChoicesCard>[0]["lockState"]) => (
      <DesignSystemProvider forcedTheme="light">
        <LangyChoicesCard card={card} lockState={lockState} onSelect={onSelect} />
      </DesignSystemProvider>
    );
    const { container, rerender } = render(view({ status: "open" }));

    fireEvent.click(screen.getByRole("button", { name: "I'd rather describe it" }));

    expect(onSelect).toHaveBeenCalledWith({
      selection: { blockId: "choice-quiet", optionIds: ["describe"] },
      card,
    });

    rerender(view({ status: "answered", optionIds: ["describe"] }));

    const ticks = container.querySelectorAll("svg.lucide-check");
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.closest("button")?.textContent).toContain("I'd rather describe it");
  });

  it("answers an open single-select question through the named action", () => {
    const onSelect = vi.fn();
    const card: LangyDerivedChoicesCard = {
      kind: "choices",
      blockId: "choice-1",
      question: "Which agent?",
      options: [{ id: "staging", label: "Staging agent" }],
    };

    render(
      <DesignSystemProvider forcedTheme="light">
        <LangyChoicesCard card={card} lockState={{ status: "open" }} onSelect={onSelect} />
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Staging agent" }));

    expect(onSelect).toHaveBeenCalledWith({
      selection: { blockId: "choice-1", optionIds: ["staging"] },
      card,
    });
  });

  it("keeps an invalid derived block visible as an expandable disclosure", () => {
    render(
      <DesignSystemProvider forcedTheme="light">
        <LangyFailedCard
          part={{
            type: "langy-card-failed",
            blockId: "failed-1",
            raw: '{"kind":"unknown"}',
          }}
        />
      </DesignSystemProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /view raw/i }));

    expect(screen.getByText('{"kind":"unknown"}')).toBeDefined();
  });
});
