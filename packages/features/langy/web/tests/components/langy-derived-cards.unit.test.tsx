/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import type {
  LangyDerivedCard,
  LangyDerivedChoicesCard,
} from "@langwatch/langy-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LangyChoicesCard } from "../../src/components/derived-cards/langy-choices-card";
import { LangyDerivedCardView } from "../../src/components/derived-cards/langy-derived-card-view";
import { LangyFailedCard } from "../../src/components/derived-cards/langy-failed-card";

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
        <LangyChoicesCard
          card={card}
          lockState={{ status: "open" }}
          onSelect={onSelect}
        />
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
