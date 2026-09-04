/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type { LangyDerivedCard, LangyDerivedChoicesCard } from "@langwatch/langy-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LangyChoicesCard } from "../langy-choices-card";
import { LangyDerivedCardView } from "../langy-derived-card-view";
import { LangyFailedCard } from "../../../elements/derived-cards/langy-failed-card";

afterEach(cleanup);

function renderCard(card: LangyDerivedCard) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyDerivedCardView card={card} />
    </ChakraProvider>,
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
        { id: "publish", label: "Publish the winning draft", ref: { type: "prompt", id: "prompt_1" } },
      ],
    };

    render(
      <ChakraProvider value={defaultSystem}>
        <LangyChoicesCard
          card={card}
          lockState={{ status: "open" }}
          onSelect={vi.fn()}
          refRows={
            new Map([["publish", { state: "live", primary: "support-reply-v1", secondary: "version 3" }]])
          }
        />
      </ChakraProvider>,
    );

    expect(screen.getByText("Publish the winning draft")).toBeDefined();
    expect(screen.getByText("support-reply-v1 · version 3")).toBeDefined();
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
      <ChakraProvider value={defaultSystem}>
        <LangyChoicesCard card={card} lockState={{ status: "open" }} onSelect={onSelect} />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Staging agent" }));

    expect(onSelect).toHaveBeenCalledWith({
      selection: { blockId: "choice-1", optionIds: ["staging"] },
      card,
    });
  });

  it("keeps an invalid derived block visible as an expandable disclosure", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <LangyFailedCard
          part={{
            type: "langy-card-failed",
            blockId: "failed-1",
            raw: '{"kind":"unknown"}',
          }}
        />
      </ChakraProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /view raw/i }));

    expect(screen.getByText('{"kind":"unknown"}')).toBeDefined();
  });
});
