// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeTabs } from "../src/components/layout/code-tabs.tsx";
import { MetricTabs } from "../src/components/layout/metric-tabs.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(cleanup);

type Language = "python" | "curl";

function Snippets() {
  const [value, setValue] = useState<Language>("python");
  return (
    <CodeTabs<Language>
      label="Snippet language"
      value={value}
      onValueChange={(next) => setValue(next.value)}
      items={[
        { value: "python", label: "Python", language: "python", code: "print('hi')" },
        { value: "curl", label: "curl", language: "bash", code: "curl https://example.com" },
      ]}
    />
  );
}

describe("CodeTabs", () => {
  /** @scenario CodeTabs shows one shared body and copies the open snippet */
  it("names the language tabs, shows only the open snippet and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithDesignSystem(<Snippets />);
    expect(screen.getByRole("tablist", { name: "Snippet language" })).toBeInTheDocument();
    expect(document.body.textContent).toContain("print('hi')");
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls") ?? "")).not.toBeNull();
    }
    await user.click(screen.getByRole("tab", { name: "curl" }));
    const openPanel = () => document.querySelector("[role=tabpanel]:not([hidden])");
    await waitFor(() => expect(openPanel()?.textContent).toContain("curl https://example.com"));
    expect(document.body.textContent).not.toContain("print('hi')");
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("curl https://example.com");
    const list = screen.getByRole("tablist");
    expect(list).not.toContainElement(screen.getByRole("button", { name: /cop/i }));
  });
});

describe("MetricTabs", () => {
  function Metrics() {
    const [value, setValue] = useState<"docs" | "cost">("docs");
    return (
      <MetricTabs<"docs" | "cost">
        label="Metrics"
        value={value}
        onValueChange={(next) => setValue(next.value)}
        items={[
          { value: "docs", label: "Total documents", figure: "1,284", content: <p>docs chart</p> },
          { value: "cost", label: "Cost", figure: "$42", content: <p>cost chart</p> },
        ]}
      />
    );
  }

  /** @scenario MetricTabs names a tab by label and figure and waits for Enter */
  it("names each tab by its label then its figure and unmounts closed panels", () => {
    renderWithDesignSystem(<Metrics />);
    expect(screen.getByRole("tab", { name: "Total documents 1,284" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("docs chart")).toBeInTheDocument();
    expect(screen.queryByText("cost chart")).toBeNull();
  });

  /** @scenario MetricTabs names a tab by label and figure and waits for Enter */
  it("moves focus with arrows but selects only on Enter, so arrowing past fires no query", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Metrics />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: /Cost/ })).toHaveFocus());
    expect(screen.queryByText("cost chart")).toBeNull();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByText("cost chart")).toBeInTheDocument());
  });
});
