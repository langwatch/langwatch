/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("SlackBlockKitTemplatePicker", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a trace draft on the immediate cadence", () => {
    it("shows the trace layouts and none of the graph-alert ones", () => {
      renderPicker();

      expect(
        screen.getByRole("button", { name: /use compact alert template/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: /use alert — compact template/i,
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
        screen.getByRole("button", { name: /use compact alert template/i }),
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
        screen.getByRole("button", { name: /use alert — compact template/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use alert — detailed template/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use one-liner template/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use compact alert template/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /use digest/i }),
      ).not.toBeInTheDocument();
    });

    it("marks the compact alert as the default", () => {
      renderPicker({ kind: "graphAlert" });

      const compactCard = screen.getByRole("button", {
        name: /use alert — compact template/i,
      });
      expect(compactCard.textContent).toContain("Default");
    });

    it("hides the other-cadence disclosure because alerts have no digest layouts", () => {
      renderPicker({ kind: "graphAlert" });

      expect(
        screen.queryByText(/more layouts for/i),
      ).not.toBeInTheDocument();
    });
  });
});
