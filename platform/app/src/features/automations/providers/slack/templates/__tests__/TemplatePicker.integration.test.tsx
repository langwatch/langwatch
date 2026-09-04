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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pickDefaultSlackBlockKitTemplateId,
  templateOptionsFor,
} from "../registry";
import { SlackBlockKitTemplatePicker } from "../TemplatePicker";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const pickerElement = (
  props: Partial<Parameters<typeof SlackBlockKitTemplatePicker>[0]> = {},
) => (
  <SlackBlockKitTemplatePicker
    cadence="immediate"
    kind="trace"
    deliveryMethod="webhook"
    hasEvaluationFilter={false}
    currentSource=""
    onSelect={vi.fn()}
    {...props}
  />
);

const renderPicker = (
  props: Partial<Parameters<typeof SlackBlockKitTemplatePicker>[0]> = {},
) => render(pickerElement(props), { wrapper: Wrapper });

/** The layouts in the order the list renders them, by registry id. */
const layoutOrder = () =>
  screen.getAllByRole("option").map((el) => el.getAttribute("data-layout-id"));

const layout = (name: RegExp) => screen.getByRole("option", { name });

const preview = () => within(screen.getByTestId("layout-preview"));

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

    // The receive chooser above the picker is the one cadence control: the
    // list carries only the layouts for the draft's cadence, so a pick here
    // can never switch the cadence behind the author's back.
    it("lists only the layouts for the draft's cadence, and re-filters when it changes", () => {
      const { rerender } = renderPicker();

      expect(layoutOrder()).toEqual([
        "trace_alert_compact",
        "trace_alert_one_liner",
        "eval_failure_detailed",
        "trace_card_rich",
        "eval_failure_rich",
      ]);

      rerender(pickerElement({ cadence: "digest" }));

      expect(layoutOrder()).toEqual([
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

    it("lands the preview back on an offered layout after a cadence switch drops the highlighted one", async () => {
      const user = userEvent.setup();
      const { rerender } = renderPicker();

      // Land on a per-trace layout...
      await user.tab();
      await user.keyboard("{ArrowDown}");
      expect(preview().getByText("One-liner")).toBeInTheDocument();

      // ...then the chooser above moves the draft to batches: the layout the
      // author was looking at is no longer offered, so the preview must fall
      // back to something that is.
      rerender(pickerElement({ cadence: "digest" }));

      expect(preview().queryByText("One-liner")).not.toBeInTheDocument();
      const digestDefault = templateOptionsFor({
        cadence: "digest",
        kind: "trace",
      }).find(
        (option) =>
          option.id ===
          pickDefaultSlackBlockKitTemplateId({
            cadence: "digest",
            hasEvaluationFilter: false,
            kind: "trace",
          }),
      );
      expect(
        preview().getByText(digestDefault!.displayName),
      ).toBeInTheDocument();
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
      renderPicker({ deliveryMethod: "webhook", onSelect });

      // "Eval failure banner" leads with a gated `alert` block.
      const gated = layout(/eval failure banner/i);
      expect(gated).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(gated);

      expect(preview().getByText("Eval failure banner")).toBeInTheDocument();
      expect(
        preview().getByText("Needs a Slack app connection"),
      ).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
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
  });

  describe("given a report draft", () => {
    it("lists every layout its source can fill once", () => {
      renderPicker({ kind: "report", reportSource: "traceQuery" });

      expect(layoutOrder()).toEqual([
        "report_table",
        "report_digest",
        "report_summary_card",
      ]);
    });
  });
});
