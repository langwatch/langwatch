/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    it("shows the trace layouts and none of the graph-alert ones", () => {
      renderPicker();

      expect(
        screen.getByRole("button", { name: /use compact notice template/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /use metric — compact template/i,
        }),
      ).not.toBeInTheDocument();
    });

    it("offers the digest layouts behind the other-cadence disclosure", () => {
      renderPicker();

      expect(
        screen.getByText(/more layouts for digest cadences/i),
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
        screen.getByRole("button", {
          name: new RegExp(`use ${firstOption!.displayName} template`, "i"),
        }),
      );

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]![0]).toMatchObject({
        id: firstOption!.id,
        source: firstOption!.source,
      });
    });
  });

  describe("given a webhook connection", () => {
    it("renders a template that needs a Slack app but blocks selecting it", () => {
      const onSelect = vi.fn();
      renderPicker({ deliveryMethod: "webhook", onSelect });

      // "Eval failure banner" leads with a gated `alert` block.
      const gatedCard = screen.getByRole("button", {
        name: /use eval failure banner template/i,
      });
      expect(gatedCard).toBeDisabled();
      expect(gatedCard.textContent).toContain("Needs a Slack app connection");

      fireEvent.click(gatedCard);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("keeps a non-gated template selectable", () => {
      renderPicker({ deliveryMethod: "webhook" });

      expect(
        screen.getByRole("button", { name: /use compact notice template/i }),
      ).toBeEnabled();
    });
  });

  describe("given a bot connection", () => {
    it("lets the author select a template that needs a Slack app", () => {
      const onSelect = vi.fn();
      renderPicker({ deliveryMethod: "bot", onSelect });

      const gatedCard = screen.getByRole("button", {
        name: /use eval failure banner template/i,
      });
      expect(gatedCard).toBeEnabled();

      fireEvent.click(gatedCard);
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a graph-alert draft", () => {
    it("shows only the graph-alert layouts", () => {
      renderPicker({ kind: "graphAlert" });

      expect(
        screen.getByRole("button", { name: /use metric — compact template/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use metric — detailed template/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use one-liner template/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use compact notice template/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use digest/i }),
      ).not.toBeInTheDocument();
    });

    it("marks the compact notice as the default", () => {
      renderPicker({ kind: "graphAlert" });

      const compactCard = screen.getByRole("button", {
        name: /use metric — compact template/i,
      });
      expect(compactCard.textContent).toContain("Default");
    });

    it("hides the other-cadence disclosure because alerts have no digest layouts", () => {
      renderPicker({ kind: "graphAlert" });

      expect(screen.queryByText(/more layouts for/i)).not.toBeInTheDocument();
    });
  });

  describe("when a cross-cadence layout is picked from the expanded disclosure", () => {
    /** @scenario "Cross-cadence layout picking keeps list order" */
    it("keeps the primary grid's list order instead of regrouping around the new cadence", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} />, { wrapper: Wrapper });

      const namesBefore = screen
        .getAllByRole("button", { name: /^use .+ template$/i })
        .slice(0, 5)
        .map((el) => el.getAttribute("aria-label"));
      // The immediate-cadence layouts render first, in this order, per the
      // registry — captured before any pick to compare against after.
      expect(namesBefore).toEqual([
        "Use Compact notice template",
        "Use One-liner template",
        "Use Eval failure detail template",
        "Use Rich trace card template",
        "Use Eval failure banner template",
      ]);

      await user.click(screen.getByText(/more layouts for digest cadences/i));
      await user.click(
        screen.getByRole("button", { name: /use digest — compact template/i }),
      );

      // The cadence switched (the picker now renders against "digest"), but
      // the grid the author is looking at must not have reshuffled: the same
      // five immediate cards, in the same order, still lead.
      const namesAfter = screen
        .getAllByRole("button", { name: /^use .+ template$/i })
        .slice(0, 5)
        .map((el) => el.getAttribute("aria-label"));
      expect(namesAfter).toEqual(namesBefore);
    });
  });

  describe("when cadence changes for a reason other than a pick made in this picker", () => {
    /** @scenario "An external cadence change regroups the gallery; an in-picker pick still does not" */
    it("regroups the gallery to match, then keeps a subsequent in-picker pick stable", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} exposeExternalCadenceControl />, {
        wrapper: Wrapper,
      });

      // Mounted on immediate — the digest layouts start behind the
      // disclosure, not in the primary grid.
      expect(
        screen.queryByRole("button", {
          name: /use digest — compact template/i,
        }),
      ).not.toBeInTheDocument();

      // The author switches cadence from the Delivery step's own cadence
      // control, not from anything in this picker.
      await user.click(
        screen.getByRole("button", {
          name: /change cadence in the cadence section/i,
        }),
      );

      // The gallery must track the real cadence — this was never a pick made
      // here, so the mount-time latch must not have suppressed the regroup.
      expect(
        screen.getByRole("button", { name: /use digest — compact template/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use compact notice template/i }),
      ).not.toBeInTheDocument();

      const namesAfterExternalChange = screen
        .getAllByRole("button", { name: /^use .+ template$/i })
        .slice(0, 4)
        .map((el) => el.getAttribute("aria-label"));

      // From here, an in-picker cross-cadence pick must still behave exactly
      // as the sibling test above expects: no reshuffling as a result of the
      // pick itself.
      await user.click(
        screen.getByText(/more layouts for the immediate cadence/i),
      );
      await user.click(
        screen.getByRole("button", { name: /use compact notice template/i }),
      );

      const namesAfterInPickerPick = screen
        .getAllByRole("button", { name: /^use .+ template$/i })
        .slice(0, 4)
        .map((el) => el.getAttribute("aria-label"));
      expect(namesAfterInPickerPick).toEqual(namesAfterExternalChange);
    });

    it("still regroups after two consecutive in-picker picks land on the same cadence", async () => {
      const user = userEvent.setup();
      render(<StatefulPicker onPick={vi.fn()} exposeExternalCadenceControl />, {
        wrapper: Wrapper,
      });

      // Expand the digest section and pick two different digest layouts in a
      // row without leaving it — comparison-shopping between the digest
      // templates the registry offers, which the still-open disclosure
      // supports. "Digest — inline rich" (unlike "evaluator chart"/"table")
      // carries no gated block, so it stays clickable on this webhook
      // connection. The first pick genuinely changes the cadence prop
      // ("immediate" -> "digest"); the second does not (cadence is already
      // "digest"), which is exactly the case the marker guard has to survive.
      await user.click(screen.getByText(/more layouts for digest cadences/i));
      await user.click(
        screen.getByRole("button", { name: /use digest — compact template/i }),
      );
      await user.click(
        screen.getByRole("button", {
          name: /use digest — inline rich template/i,
        }),
      );

      // Neither in-picker pick should have regrouped the gallery on its own
      // — same contract as the sibling test above.
      expect(
        screen.getByRole("button", { name: /use compact notice template/i }),
      ).toBeInTheDocument();

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

      // The gallery must reflect the real (digest) cadence now: the digest
      // layouts lead the PRIMARY grid (the first 4 buttons — digest cadence
      // has exactly 4 trace templates). The disclosure is still open from
      // the setup above and now holds the immediate layouts instead, so
      // "Compact notice" is still somewhere in the document — checked by
      // POSITION, not presence.
      const primaryNames = screen
        .getAllByRole("button", { name: /^use .+ template$/i })
        .slice(0, 4)
        .map((el) => el.getAttribute("aria-label"));
      expect(primaryNames).toEqual(
        expect.arrayContaining([
          "Use Digest — compact template",
          "Use Digest — inline rich template",
        ]),
      );
      expect(primaryNames).not.toContain("Use Compact notice template");
    });
  });
});
