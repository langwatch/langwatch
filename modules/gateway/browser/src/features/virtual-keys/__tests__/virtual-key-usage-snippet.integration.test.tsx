/**
 * @vitest-environment jsdom
 * Tests that the usage example names a model the key can actually serve,
 * threading the eligible-provider model into the snippet.
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { fakeGatewayHost, renderWithGatewayHost } from "../../../testing.tsx";
import { VirtualKeyUsageSnippet } from "../ui/sections/virtual-key-usage-snippet.tsx";

/** Where the snippet says to point an SDK, as a local deployment answers it. */
const host = fakeGatewayHost({
  deployment: {
    isSaas: false,
    appBaseUrl: "http://localhost:5560",
    gatewayBaseUrl: "http://localhost:5563",
  },
});

describe("given a VirtualKeyUsageSnippet", () => {
  afterEach(() => cleanup());

  describe("when a custom-provider model is passed", () => {
    /** @scenario Usage example defaults to a model the key can serve */
    it("embeds custom/<model> in the copy-paste example, not gpt-5-mini", async () => {
      const { container } = renderWithGatewayHost(
        <VirtualKeyUsageSnippet secret="vk-lw-testsecret" model="custom/Qwen2.5-0.5B-Instruct" />,
        { host },
      );

      await waitFor(() => {
        expect(container.textContent).toContain("custom/Qwen2.5-0.5B-Instruct");
      });
      expect(container.textContent).not.toContain("gpt-5-mini");
    });
  });

  describe("when no model is passed", () => {
    /** @scenario Usage example falls back to a safe placeholder when no provider is resolvable */
    it("falls back to the gpt-5-mini placeholder", async () => {
      const { container } = renderWithGatewayHost(
        <VirtualKeyUsageSnippet secret="vk-lw-testsecret" />,
        { host },
      );

      await waitFor(() => {
        expect(container.textContent).toContain("gpt-5-mini");
      });
    });
  });
  describe("when the language tabs are used", () => {
    it("pairs every tab with a panel and moves focus with the arrow keys, Home and End, selecting on Enter", async () => {
      renderWithGatewayHost(<VirtualKeyUsageSnippet secret="vk-lw-testsecret" />, { host });
      const user = userEvent.setup();

      const python = await screen.findByTestId("vk-usage-tab-python");
      const typescript = screen.getByTestId("vk-usage-tab-typescript");
      expect(screen.getAllByRole("tab")).toHaveLength(4);
      const panels = screen.getAllByRole("tabpanel", { hidden: true });
      expect(panels).toHaveLength(4);
      for (const tab of screen.getAllByRole("tab")) {
        expect(panels.some((panel) => panel.getAttribute("aria-labelledby") === tab.id)).toBe(true);
      }
      expect(document.getElementById(python.getAttribute("aria-controls") ?? "")).toHaveAttribute(
        "role",
        "tabpanel",
      );

      python.focus();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(typescript).toHaveFocus());
      expect(python).toHaveAttribute("aria-selected", "true");
      await user.keyboard("{Enter}");
      await waitFor(() => expect(typescript).toHaveAttribute("aria-selected", "true"));

      await user.keyboard("{End}");
      await waitFor(() => expect(screen.getByTestId("vk-usage-tab-bash")).toHaveFocus());
      await user.keyboard("{Home}");
      await waitFor(() => expect(python).toHaveFocus());
    });

    it("copies the code of the active language and leaves the selected tab alone", async () => {
      renderWithGatewayHost(<VirtualKeyUsageSnippet secret="vk-lw-testsecret" />, { host });
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("vk-usage-tab-go"));
      await user.click(screen.getByRole("button", { name: "Copy code" }));

      expect(await navigator.clipboard.readText()).toContain("package main");
      expect(screen.getByTestId("vk-usage-tab-go")).toHaveAttribute("aria-selected", "true");
    });
  });
});
