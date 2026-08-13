/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { templateOptionsFor } from "../registry";
import { SlackBlockKitTemplatePicker } from "../TemplatePicker";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderPicker = (
  props: Partial<Parameters<typeof SlackBlockKitTemplatePicker>[0]> = {},
) =>
  render(
    <SlackBlockKitTemplatePicker
      cadence="immediate"
      kind="trace"
      deliveryMethod="webhook"
      hasEvaluationFilter={false}
      currentSource=""
      onSelect={vi.fn()}
      onSelectOtherCadence={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper },
  );

/** The layouts in the order the list renders them, by registry id. Order is
 *  what the grouping latch controls, so every latch test reads it. */
const layoutOrder = () =>
  screen.getAllByRole("option").map((el) => el.getAttribute("data-layout-id"));

const layout = (name: RegExp) => screen.getByRole("option", { name });

const preview = () => within(screen.getByTestId("layout-preview"));

/** Stands in for the composer's draft: `cadence` flows back down as a live
 *  prop once `onSelectOtherCadence` fires, exactly like the real form owner
 *  reacting to `ctx.setNotificationCadence`. `exposeExternalCadenceControl`
 *  adds a second, independent control — standing in for the separate
 *  Cadence section, which the composer keeps open at the same time as this
 *  picker (facets are independently open, not a single-open accordion) — so
 *  a test can change `cadence` WITHOUT going through the picker itself. */
function StatefulPicker({
  onPick,
  exposeExternalCadenceControl = false,
}: {
  onPick: (
    option: Parameters<
      Parameters<typeof SlackBlockKitTemplatePicker>[0]["onSelect"]
    >[0],
  ) => void;
  exposeExternalCadenceControl?: boolean;
}) {
  const [cadence, setCadence] = useState<"immediate" | "digest">("immediate");
  const [currentSource, setCurrentSource] = useState("");
  return (
    <>
      {/* The draft's live cadence, so a test can watch a cross-cadence pick
          drive it the way the form owner's `setNotificationCadence` does. */}
      <p data-testid="draft-cadence">{cadence}</p>
      {exposeExternalCadenceControl ? (
        <button
          type="button"
          onClick={() =>
            setCadence((c) => (c === "digest" ? "immediate" : "digest"))
          }
        >
          Change cadence in the Cadence section
        </button>
      ) : null}
      <SlackBlockKitTemplatePicker
        cadence={cadence}
        kind="trace"
        deliveryMethod="webhook"
        hasEvaluationFilter={false}
        currentSource={currentSource}
        onSelect={(option) => {
          setCurrentSource(option.source);
          onPick(option);
        }}
        onSelectOtherCadence={(option) => {
          setCadence(option.cadenceFit === "digest" ? "digest" : "immediate");
          setCurrentSource(option.source);
          onPick(option);
        }}
      />
    </>
  );
}

describe("SlackBlockKitTemplatePicker", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a trace draft on the immediate cadence", () => {
    it("lists the trace layouts and none of the graph-alert ones", () => {
      renderPicker();

      expect(layout(/compact notice/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /metric — compact/i }),
      ).not.toBeInTheDocument();
    });

    it("groups the per-trace layouts first and the digest layouts under their own heading", () => {
      renderPicker();

      expect(
        screen.getByRole("group", { name: /one message per trace/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: /one digest message/i }),
      ).toBeInTheDocument();
      expect(layoutOrder()).toEqual([
        "trace_alert_compact",
        "trace_alert_one_liner",
        "eval_failure_detailed",
        "trace_card_rich",
        "eval_failure_rich",
        "digest_compact",
        "digest_evaluator_rollup",
        "digest_inline_rich",
        "digest_table",
      ]);
    });

    /** @scenario "The layout list previews the layout the author lands on" */
    it("previews the layout the automation already uses, not the default one", () => {
      // Deliberately NOT the default (that is "Compact notice"): a preview
      // that only ever opened on the default would pass a test written
      // against a pristine draft while showing an editing author the wrong
      // layout.
      const oneLiner = templateOptionsFor({
        cadence: "immediate",
        kind: "trace",
      }).find((option) => option.id === "trace_alert_one_liner");
      renderPicker({ currentSource: oneLiner!.source });

      expect(preview().getByText("One-liner")).toBeInTheDocument();
      expect(preview().queryByText("Compact notice")).not.toBeInTheDocument();
      // What one message contains, what the layout is for, and its structure.
      expect(preview().getByText(oneLiner!.deliveryNote)).toBeInTheDocument();
      expect(preview().getByText(oneLiner!.tagline)).toBeInTheDocument();
      expect(preview().getByText(/capital of France/i)).toBeInTheDocument();
    });

    it("falls back to the default layout while the draft is pristine", () => {
      renderPicker();

      expect(preview().getByText("Compact notice")).toBeInTheDocument();
      expect(preview().getByText("Default")).toBeInTheDocument();
      expect(preview().getByText("1 message per trace")).toBeInTheDocument();
    });
  });

  describe("when a layout is picked", () => {
    it("hands the chosen option back to the caller", () => {
      const onSelect = vi.fn();
      const [firstOption] = templateOptionsFor({
        cadence: "immediate",
        kind: "trace",
      });
      renderPicker({ onSelect });

      fireEvent.click(
        layout(new RegExp(firstOption!.displayName.toLowerCase(), "i")),
      );

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]![0]).toMatchObject({
        id: firstOption!.id,
        source: firstOption!.source,
      });
    });

    it("marks the layout the automation uses as selected", () => {
      const [, secondOption] = templateOptionsFor({
        cadence: "immediate",
        kind: "trace",
      });
      renderPicker({ currentSource: secondOption!.source });

      expect(layout(/one-liner/i)).toHaveAttribute("aria-selected", "true");
      expect(layout(/compact notice/i)).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("marks nothing as selected once the message is customised", () => {
      renderPicker({ currentSource: "{{ hand written }}" });

      for (const option of screen.getAllByRole("option")) {
        expect(option).toHaveAttribute("aria-selected", "false");
      }
    });
  });

  describe("when the author moves through the list with the keyboard", () => {
    it("previews the next layout without applying it", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderPicker({ onSelect });

      await user.tab();
      await user.keyboard("{ArrowDown}");

      expect(preview().getByText("One-liner")).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("applies the previewed layout on Enter", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderPicker({ onSelect });

      await user.tab();
      await user.keyboard("{ArrowDown}{Enter}");

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]![0]).toMatchObject({
        id: "trace_alert_one_liner",
      });
    });
  });

  describe("given a webhook connection", () => {
    /** @scenario "A layout that needs a Slack app connection is previewed but cannot be picked" */
    /** @scenario "The richer templates are offered only for a bot connection" */
    it("previews a layout that needs a Slack app but refuses to apply it", () => {
      const onSelect = vi.fn();
      const onSelectOtherCadence = vi.fn();
      renderPicker({
        deliveryMethod: "webhook",
        onSelect,
        onSelectOtherCadence,
      });

      // "Eval failure banner" leads with a gated `alert` block.
      const gated = layout(/eval failure banner/i);
      expect(gated).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(gated);

      expect(preview().getByText("Eval failure banner")).toBeInTheDocument();
      expect(
        preview().getByText("Needs a Slack app connection"),
      ).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
      expect(onSelectOtherCadence).not.toHaveBeenCalled();
    });

    it("keeps a layout that needs no Slack app applicable", () => {
      renderPicker({ deliveryMethod: "webhook" });

      expect(layout(/compact notice/i)).not.toHaveAttribute("aria-disabled");
    });
  });

  describe("given a bot connection", () => {
    it("lets the author apply a layout that needs a Slack app", () => {
      const onSelect = vi.fn();
      renderPicker({ deliveryMethod: "bot", onSelect });

      const gated = layout(/eval failure banner/i);
      expect(gated).not.toHaveAttribute("aria-disabled");

      fireEvent.click(gated);

      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a graph-alert draft", () => {
    it("lists only the graph-alert layouts", () => {
      renderPicker({ kind: "graphAlert" });

      expect(layout(/metric — compact/i)).toBeInTheDocument();
      expect(layout(/metric — detailed/i)).toBeInTheDocument();
      expect(layout(/one-liner/i)).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /compact notice/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /digest/i }),
      ).not.toBeInTheDocument();
    });

    it("marks the compact metric layout as the default", () => {
      renderPicker({ kind: "graphAlert" });

      expect(
        within(layout(/metric — compact/i)).getByText("Default"),
      ).toBeInTheDocument();
    });

    it("shows no cadence groups, because alerts always fire on the spot", () => {
      renderPicker({ kind: "graphAlert" });

      expect(screen.queryAllByRole("group")).toHaveLength(0);
    });
  });

  describe("given a report draft", () => {
    it("lists every layout its source can fill once, without cadence groups", () => {
      renderPicker({ kind: "report", reportSource: "traceQuery" });

      expect(layoutOrder()).toEqual([
        "report_table",
        "report_digest",
        "report_summary_card",
      ]);
      expect(screen.queryAllByRole("group")).toHaveLength(0);
    });
  });

  describe("when a cross-cadence layout is picked", () => {
    /** @scenario "Cross-cadence layout picking keeps list order" */
    it("switches the draft's cadence but keeps the list order", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} />, { wrapper: Wrapper });

      // The immediate-cadence layouts lead, in registry order, with the
      // digest ones under the second heading — captured before any pick to
      // compare against after.
      const orderBefore = layoutOrder();
      expect(orderBefore[0]).toBe("trace_alert_compact");
      expect(screen.getByTestId("draft-cadence")).toHaveTextContent(
        "immediate",
      );

      await user.click(layout(/digest — compact/i));

      // The pick moved the draft onto the layout's own cadence...
      expect(screen.getByTestId("draft-cadence")).toHaveTextContent("digest");
      // ...and the list the author is looking at must not have reordered.
      expect(layoutOrder()).toEqual(orderBefore);
    });

    it("tells the author the cadence the layout switches them to", () => {
      renderPicker();

      fireEvent.click(layout(/digest — compact/i));

      expect(preview().getByText(/5 minute digest/i)).toBeInTheDocument();
    });
  });

  describe("when cadence changes for a reason other than a pick made in this picker", () => {
    /** @scenario "An external cadence change reorders the layout list; an in-picker pick still does not" */
    it("reorders the list to match, then keeps a subsequent in-picker pick stable", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} exposeExternalCadenceControl />, {
        wrapper: Wrapper,
      });

      // Mounted on immediate — the per-trace layouts lead.
      expect(layoutOrder()[0]).toBe("trace_alert_compact");

      // The author switches cadence from the Delivery step's own cadence
      // control, not from anything in this picker.
      await user.click(
        screen.getByRole("button", {
          name: /change cadence in the cadence section/i,
        }),
      );

      // The list must track the real cadence — this was never a pick made
      // here, so the mount-time latch must not have suppressed the regroup.
      const orderAfterExternalChange = layoutOrder();
      expect(orderAfterExternalChange[0]).toBe("digest_compact");

      // From here, an in-picker cross-cadence pick must still behave exactly
      // as the sibling test above expects: no reordering as a result of the
      // pick itself.
      await user.click(layout(/compact notice/i));

      expect(layoutOrder()).toEqual(orderAfterExternalChange);
    });

    it("still reorders after two consecutive in-picker picks land on the same cadence", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} exposeExternalCadenceControl />, {
        wrapper: Wrapper,
      });

      // Pick two different digest layouts in a row — comparison-shopping
      // between the digest layouts the registry offers. "Digest — inline
      // rich" (unlike "evaluator chart"/"table") carries no gated block, so
      // it stays applicable on this webhook connection. The first pick
      // genuinely changes the cadence prop ("immediate" -> "digest"); the
      // second does not (cadence is already "digest"), which is exactly the
      // case the marker guard has to survive.
      await user.click(layout(/digest — compact/i));
      await user.click(layout(/digest — inline rich/i));

      // Neither in-picker pick should have reordered the list on its own —
      // same contract as the sibling test above.
      expect(layoutOrder()[0]).toBe("trace_alert_compact");

      // Now the cadence changes externally, twice: once back to "immediate"
      // (a no-op for the grouping, since it was never anything else) and
      // once back to "digest" — the value the second in-picker pick would
      // have left a stale, unconsumed marker on on a run with the bug. If
      // that marker check is wrong, this change is misread as a pick made in
      // the picker and the regroup is skipped.
      const externalToggle = screen.getByRole("button", {
        name: /change cadence in the cadence section/i,
      });
      await user.click(externalToggle);
      await user.click(externalToggle);

      // The list must reflect the real (digest) cadence now: the digest
      // layouts lead it, and the per-trace ones follow under their heading.
      expect(layoutOrder().slice(0, 4)).toEqual([
        "digest_compact",
        "digest_evaluator_rollup",
        "digest_inline_rich",
        "digest_table",
      ]);
    });
  });
});
