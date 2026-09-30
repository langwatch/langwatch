/**
 * @vitest-environment jsdom
 *
 * The per-pool seat meter inside the seats lane card.
 *
 * The claim under test is that the meter states HOW FULL a pool is in the
 * length of its fill, and not in the fill's colour. That distinction is the
 * whole reason this meter parts company with the shared primitive's other
 * three consumers, which do colour by reading — they measure against a limit
 * somebody typed, and a seat contract has no limit on it.
 *
 * A note on the instrument, because the governance tests have twice recorded
 * that jsdom cannot see a chart's colours and that is only half true. jsdom
 * resolves no CSS VARIABLE, so what a token finally paints is genuinely out of
 * reach here. But Chakra emits its generated rule into a real `<style>` tag,
 * and that tag holds the token REFERENCE — `background:var(--chakra-colors-
 * teal-solid)` — which is exactly the level this rule is written at. So the
 * colour is read from the emitted CSS rather than guessed at from a class name,
 * whose hash also moves with the width and would make this test pass or fail
 * for the wrong reason.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature,
 * "A meter is not a trend mark"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GovernanceSeatLaneDto } from "../../../../ee/governance/services/governanceCost.service";
import { SeatLanePanel } from "../CostLanePanel";
import { CHART_SEAT_FILL } from "../chartTheme";

afterEach(cleanup);

/** One pool almost entirely idle, one almost entirely sat in. */
const TWO_POOLS: GovernanceSeatLaneDto = {
  status: "reported",
  pools: [
    {
      skuPartNumber: "VIRTUAL_AGENT_USL",
      day: "2026-09-01",
      seatsBought: 100,
      seatsAssigned: 10,
    },
    {
      skuPartNumber: "COPILOT_BUSINESS",
      day: "2026-09-01",
      seatsBought: 100,
      seatsAssigned: 95,
    },
  ],
};

function renderPanel(seats: GovernanceSeatLaneDto) {
  render(
    <ChakraProvider value={defaultSystem}>
      <SeatLanePanel seats={seats} testId="cost-lane-seats" />
    </ChakraProvider>,
  );
}

/** The fill inside each meter track, in the order the pools were given. */
function meterFills(): HTMLElement[] {
  return screen.getAllByTestId("seat-pool-meter").map((track) => {
    const fill = track.querySelector<HTMLElement>("[data-fill-ratio]");
    if (!fill) throw new Error("a meter rendered no fill");
    return fill;
  });
}

/**
 * One declaration out of the rule Chakra generated for an element.
 *
 * Throws rather than returning null when nothing matches: a silent miss would
 * make every comparison below pass on two undefineds, which is the shape of a
 * test that has stopped looking.
 */
function declaration(element: HTMLElement, property: string): string {
  const cls = element.className.split(" ")[0]!;
  for (const tag of Array.from(document.querySelectorAll("style"))) {
    const rule = new RegExp(`\\.${cls}\\{([^}]*)\\}`).exec(
      tag.textContent ?? "",
    )?.[1];
    const value = rule
      ? new RegExp(`(?:^|;)${property}:([^;]*)`).exec(rule)?.[1]
      : undefined;
    if (value) return value;
  }
  throw new Error(`no ${property} in the rule for .${cls}`);
}

describe("the seat meter states a level without grading it", () => {
  /** @scenario "A meter states its level by length rather than by a colour that grades it" */
  it("draws two pools at opposite ends in one colour and two lengths", () => {
    renderPanel(TWO_POOLS);

    const [idle, busy] = meterFills();

    // The level is carried here: in the width, and in the ratio that is the
    // same number written where a test can read it without resolving styling.
    expect(declaration(idle!, "width")).toBe("10%");
    expect(declaration(busy!, "width")).toBe("95%");
    expect(idle!.getAttribute("data-fill-ratio")).toBe("0.1");
    expect(busy!.getAttribute("data-fill-ratio")).toBe("0.95");

    // And not here. A pool nearly all idle and a pool nearly all sat in are
    // painted the same, because neither is a verdict — the panel reports how
    // full each pool is and leaves whether that is bad to the reader.
    expect(declaration(idle!, "background")).toBe(
      declaration(busy!, "background"),
    );
    // Pinned to the seats hue rather than just "equal", so that two meters
    // agreeing on the WRONG colour is still a failure. This is the constant
    // the seat bars in the chart above take, which is the point of it.
    expect(declaration(idle!, "background")).toBe(CHART_SEAT_FILL);
  });

  it("gives a pool with no seats bought a bare track rather than a full one", () => {
    // A pool that bought nothing has no fraction to state. That is a different
    // sentence from "none of them are assigned", and the meter has a form for
    // it: the track alone. Reported as a division that never happened rather
    // than as a zero, which would be a measurement nobody made.
    renderPanel({
      status: "reported",
      pools: [
        {
          skuPartNumber: "VIRTUAL_AGENT_USL",
          day: "2026-09-01",
          seatsBought: 0,
          seatsAssigned: 0,
        },
      ],
    });

    const track = screen.getByTestId("seat-pool-meter");

    expect(track).toBeTruthy();
    expect(track.querySelector("[data-fill-ratio]")).toBeNull();
  });
});
