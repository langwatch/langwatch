/**
 * @vitest-environment jsdom
 *
 * A quiet option on the choices card: an underlined link under the bordered
 * rows that answers exactly like one of them.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { LangyDerivedChoicesCard } from "@langwatch/langy";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p_demo", slug: "demo" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    publicEnv: { useQuery: () => ({ data: {} }) },
  },
}));

import { LangyChoicesCard } from "../components/derived-cards/LangyChoicesCard";

afterEach(cleanup);

const CARD: LangyDerivedChoicesCard = {
  kind: "choices",
  blockId: "first-scenario",
  question: "Can I create and run it for you?",
  options: [
    { id: "go", label: "Sure, go ahead!" },
    { id: "chat", label: "Chat about this", quiet: true },
  ],
};

function renderCard(
  over: Partial<Parameters<typeof LangyChoicesCard>[0]> = {},
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyChoicesCard
        card={CARD}
        lockState={{ status: "open" }}
        onSelect={vi.fn()}
        refRowsOverride={new Map()}
        {...over}
      />
    </ChakraProvider>,
  );
}

describe("given an open choices card whose second option is quiet", () => {
  /** @scenario "A quiet option renders as an underlined link" */
  it("draws the first option as a bordered row and the quiet one as a link below it", () => {
    renderCard();

    const [go, chat] = screen.getAllByTestId("langy-choice-option");
    expect(go!.getAttribute("data-quiet")).toBeNull();
    expect(chat!.getAttribute("data-quiet")).toBe("true");
    expect(chat!.textContent).toBe("Chat about this");
    expect(getComputedStyle(chat!).textDecoration).toContain("underline");
    expect(
      go!.compareDocumentPosition(chat!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  /** @scenario "Picking a quiet option answers the question" */
  it("answers with the quiet option's id", () => {
    const onSelect = vi.fn();
    renderCard({ onSelect });

    fireEvent.click(screen.getByText("Chat about this"));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({
      selection: { blockId: "first-scenario", optionIds: ["chat"] },
    });
  });

  it("locks with the quiet option marked once answered", () => {
    renderCard({
      lockState: { status: "answered", optionIds: ["chat"] },
      onSelect: undefined,
    });

    const [go, chat] = screen.getAllByTestId("langy-choice-option");
    expect(chat!.getAttribute("aria-pressed")).toBe("true");
    expect(go!.getAttribute("aria-pressed")).toBe("false");
    expect((chat as HTMLButtonElement).disabled).toBe(true);
  });
});
