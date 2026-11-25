// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContentTabs,
  type ContentTabItem,
  type ContentTabsProps,
} from "../src/components/layout/content-tabs.tsx";
import { DesignSystemEnvironmentProvider } from "../src/provider/environment.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Name = "overview" | "people" | "billing";

function items(extra: Partial<Record<Name, Partial<ContentTabItem<Name>>>> = {}) {
  const base: ContentTabItem<Name>[] = [
    { value: "overview", label: "Overview", content: <p>overview panel</p> },
    { value: "people", label: "People", count: 0, content: <p>people panel</p> },
    { value: "billing", label: "Billing", content: <p>billing panel</p> },
  ];
  return base.map((item) => ({ ...item, ...extra[item.value] }));
}

type Extras = Pick<
  ContentTabsProps<Name>,
  "mount" | "activationMode" | "actions" | "panelHeader" | "density" | "body" | "inset" | "scroll"
>;

function Harness({
  initial = "overview",
  tabs = items(),
  onChange,
  ...rest
}: {
  initial?: Name;
  tabs?: ContentTabItem<Name>[];
  onChange?: (value: Name) => void;
} & Extras) {
  const [value, setValue] = useState<Name>(initial);
  return (
    <ContentTabs<Name>
      label="Sections"
      {...rest}
      value={value}
      onValueChange={(next) => {
        setValue(next.value);
        onChange?.(next.value);
      }}
      items={tabs}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });

describe("ContentTabs roles and relationships", () => {
  /** @scenario Tabs expose the tablist, tab and tabpanel relationships */
  it("names the tablist and links every tab to a panel under every mount policy", () => {
    for (const mount of ["lazy", "active", "all"] as const) {
      const { container, unmount } = renderWithDesignSystem(<Harness mount={mount} />);
      const list = screen.getByRole("tablist", { name: "Sections" });
      const tabs = within(list).getAllByRole("tab");
      expect(tabs).toHaveLength(3);
      expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
      for (const trigger of tabs) {
        const controlled = trigger.getAttribute("aria-controls") ?? "";
        const panel = container.ownerDocument.getElementById(controlled);
        expect(panel, `${mount}: ${trigger.textContent} has a panel shell`).not.toBeNull();
        expect(panel?.getAttribute("role")).toBe("tabpanel");
        expect(panel?.getAttribute("aria-labelledby")).toBe(trigger.id);
      }
      unmount();
    }
  });

  /** @scenario Tabs expose the tablist, tab and tabpanel relationships */
  it("hides closed panels with the hidden attribute and shows the open one", () => {
    renderWithDesignSystem(<Harness mount="all" />);
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
    expect(screen.getByText("people panel")).not.toBeVisible();
    expect(document.querySelectorAll("[role=tabpanel][hidden]")).toHaveLength(2);
  });

  /** @scenario Tabs expose the tablist, tab and tabpanel relationships */
  it("draws counts, and a zero shows", () => {
    renderWithDesignSystem(<Harness />);
    expect(tab("People")).toHaveTextContent("0");
    expect(tab("Overview")).not.toHaveTextContent(/\d/);
  });

  /** @scenario "A counted tab has a separated accessible name" */
  it("puts a hidden space before a count, none on an uncounted tab, and keeps arrow keys", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Harness
        tabs={[
          { value: "overview", label: "Overview", content: <p>overview panel</p> },
          { value: "people", label: "People", count: 5, content: <p>people panel</p> },
          { value: "billing", label: "Teams", count: 0, content: <p>billing panel</p> },
        ]}
      />,
    );

    expect(screen.getByRole("tab", { name: /^Overview$/ }).textContent).toBe("Overview");
    expect(screen.getByRole("tab", { name: /^People/ }).textContent).toBe("People 5");
    expect(screen.getByRole("tab", { name: /^Teams/ }).textContent).toBe("Teams 0");
    const space = screen.getByRole("tab", { name: /^People/ }).querySelector("span > span");
    expect(space?.textContent).toBe(" ");

    screen.getByRole("tab", { name: /^Overview$/ }).focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("tab", { name: /^People/ })).toHaveFocus());
    expect(screen.getByRole("tab", { name: /^People/ })).toHaveAttribute("aria-selected", "true");
  });

  /** @scenario Tabs expose the tablist, tab and tabpanel relationships */
  it("sets aria-describedby on the open panel that has a description", async () => {
    renderWithDesignSystem(
      <Harness
        initial="people"
        tabs={items({ people: { description: "Everyone in this organisation." } })}
      />,
    );
    const panel = screen.getByRole("tabpanel", { name: /People/ });
    const describedBy = panel.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)).toHaveTextContent(
      "Everyone in this organisation.",
    );
  });
});

describe("ContentTabs keyboard", () => {
  /** @scenario Arrow keys, Home and End move between tabs */
  it("moves with arrows, wraps, and jumps with Home and End, selecting as it goes", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Harness />);
    await user.tab();
    expect(tab("Overview")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab("People")).toHaveFocus());
    await waitFor(() => expect(tab("People")).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{End}");
    await waitFor(() => expect(tab("Billing")).toHaveFocus());
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab("Overview")).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(tab("Billing")).toHaveFocus());
    await user.keyboard("{Home}");
    await waitFor(() => expect(tab("Overview")).toHaveFocus());
  });

  /** @scenario Arrow keys, Home and End move between tabs */
  it("keeps one tab stop: the selected tab, then the panel", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Harness initial="people" />);
    expect(tab("People")).toHaveAttribute("tabindex", "0");
    expect(tab("Overview")).toHaveAttribute("tabindex", "-1");
    expect(tab("Billing")).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(tab("People")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: /People/ })).toHaveFocus();
  });

  /** @scenario Manual activation selects only on Enter or Space */
  it("moves focus with arrows but selects only on Enter or Space when manual", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithDesignSystem(<Harness activationMode="manual" onChange={onChange} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab("People")).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("people"));
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(tab("Billing")).toHaveFocus());
    await user.keyboard(" ");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("billing"));
  });

  /** @scenario A tab can be disabled with a reason and stays reachable */
  it("reaches a disabled tab by arrows, explains it, and never selects it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithDesignSystem(
      <Harness
        onChange={onChange}
        tabs={items({ people: { disabled: { reason: "Needs the Team plan." } } })}
      />,
    );
    const people = tab("People");
    expect(people).toHaveAttribute("aria-disabled", "true");
    const reason = people.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reason)).toHaveTextContent("Needs the Team plan.");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(people).toHaveFocus());
    await user.click(people);
    expect(onChange).not.toHaveBeenCalled();
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("overview panel")).toBeVisible();
  });
});

describe("ContentTabs values", () => {
  /** @scenario A value no tab has selects nothing and says so in development */
  it("selects nothing for an unknown value, keeps the list reachable and reports it in development", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWithDesignSystem(
      <DesignSystemEnvironmentProvider value={{ isDevelopment: true }}>
        <ContentTabs<string>
          label="Sections"
          value="ghost"
          onValueChange={() => undefined}
          items={[
            { value: "a", label: "Alpha", content: <p>alpha panel</p> },
            { value: "b", label: "Beta", content: <p>beta panel</p> },
          ]}
        />
      </DesignSystemEnvironmentProvider>,
    );
    for (const trigger of screen.getAllByRole("tab")) {
      expect(trigger).toHaveAttribute("aria-selected", "false");
    }
    expect(screen.queryByText("alpha panel")).toBeNull();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0");
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining('"ghost"')));
  });

  /** @scenario A duplicate value renders the first and reports it in development */
  it("renders the first of a duplicated value and reports it in development", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWithDesignSystem(
      <DesignSystemEnvironmentProvider value={{ isDevelopment: true }}>
        <ContentTabs<string>
          label="Sections"
          value="a"
          onValueChange={() => undefined}
          items={[
            { value: "a", label: "First", content: <p>first panel</p> },
            { value: "a", label: "Second", content: <p>second panel</p> },
          ]}
        />
      </DesignSystemEnvironmentProvider>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "First" })).toBeInTheDocument();
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("duplicate")));
  });

  /** @scenario With no enabled item every tab is disabled and no panel shows */
  it("renders every tab disabled and no open panel when none is enabled", () => {
    const off = { reason: "Off." };
    renderWithDesignSystem(
      <ContentTabs<string>
        label="Sections"
        value="none"
        onValueChange={() => undefined}
        items={[
          { value: "a", label: "Alpha", disabled: off, content: <p>alpha panel</p> },
          { value: "b", label: "Beta", disabled: off, content: <p>beta panel</p> },
        ]}
      />,
    );
    for (const trigger of screen.getAllByRole("tab")) {
      expect(trigger).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.queryByText("alpha panel")).toBeNull();
  });

  /** @scenario The selected tab stays selected when it becomes disabled */
  it("keeps a disabled current tab selected and its panel open", () => {
    renderWithDesignSystem(
      <Harness tabs={items({ overview: { disabled: { reason: "Read only now." } } })} />,
    );
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("overview panel")).toBeVisible();
  });

  /** @scenario A value changed from outside never steals focus */
  it("leaves focus alone when the value changes from outside", async () => {
    const user = userEvent.setup();
    function Outside() {
      const [value, setValue] = useState<Name>("overview");
      return (
        <>
          <button type="button" onClick={() => setValue("billing")}>
            Go to billing
          </button>
          <ContentTabs<Name>
            label="Sections"
            value={value}
            onValueChange={(next) => setValue(next.value)}
            items={items()}
          />
        </>
      );
    }
    renderWithDesignSystem(<Outside />);
    const outside = screen.getByRole("button", { name: "Go to billing" });
    await user.click(outside);
    expect(outside).toHaveFocus();
    expect(tab("Billing")).toHaveAttribute("aria-selected", "true");
  });

  /** @scenario A removed focused tab moves focus to the selected tab */
  it("moves focus to the selected tab when the focused tab leaves", async () => {
    const user = userEvent.setup();
    const view = renderWithDesignSystem(<Harness />);
    await user.click(tab("People"));
    await waitFor(() => expect(tab("People")).toHaveFocus());
    view.rerender(<Harness tabs={items().filter((item) => item.value !== "people")} />);
    await waitFor(() => expect(screen.queryByRole("tab", { name: /^People/ })).toBeNull());
    await waitFor(() => expect(tab("Overview")).toHaveFocus());
  });
});

describe("ContentTabs mount policy", () => {
  function Counter({ label }: { label: string }) {
    const [count, setCount] = useState(0);
    return (
      <button type="button" onClick={() => setCount(count + 1)}>
        {label} {count}
      </button>
    );
  }
  const tabs = items({
    overview: { content: <Counter label="chat" /> },
    people: { content: <Counter label="query" /> },
  });

  /** @scenario Panels mount lazily, only while open, or always */
  it("keeps a lazy panel's state after leaving it (a chat survives)", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Harness mount="lazy" tabs={tabs} />);
    await user.click(screen.getByRole("button", { name: "chat 0" }));
    await user.click(tab("People"));
    expect(screen.getByRole("button", { name: "chat 1", hidden: true })).not.toBeVisible();
    await user.click(tab("Overview"));
    expect(screen.getByRole("button", { name: "chat 1" })).toBeVisible();
  });

  /** @scenario Panels mount lazily, only while open, or always */
  it("unmounts an active-mount panel when it closes (a query is disposed)", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<Harness mount="active" tabs={tabs} />);
    await user.click(screen.getByRole("button", { name: "chat 0" }));
    await user.click(tab("People"));
    expect(screen.queryByRole("button", { name: /chat/ })).toBeNull();
    await user.click(tab("Overview"));
    expect(screen.getByRole("button", { name: "chat 0" })).toBeInTheDocument();
  });

  /** @scenario Panels mount lazily, only while open, or always */
  it("mounts every panel's children at once when all, and none before the first open when lazy", () => {
    const all = renderWithDesignSystem(<Harness mount="all" tabs={tabs} />);
    expect(screen.getByText(/^query/)).toBeInTheDocument();
    all.unmount();
    renderWithDesignSystem(<Harness mount="lazy" tabs={tabs} />);
    expect(screen.queryByText(/^query/)).toBeNull();
  });
});

describe("ContentTabs strip", () => {
  /** @scenario Actions and the panel header sit outside the tablist */
  it("puts actions after the tablist, outside it, before the panel in tab order", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Harness
        actions={<button type="button">Add query</button>}
        panelHeader={<div data-testid="divider">divider</div>}
      />,
    );
    const list = screen.getByRole("tablist");
    const add = screen.getByRole("button", { name: "Add query" });
    expect(list).not.toContainElement(add);
    expect(list).not.toContainElement(screen.getByTestId("divider"));
    await user.tab();
    expect(tab("Overview")).toHaveFocus();
    await user.tab();
    expect(add).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });

  /** @scenario Actions and the panel header sit outside the tablist */
  it("keeps the panel header across tabs, outside every panel", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(
      <Harness mount="all" panelHeader={<div data-testid="divider">divider</div>} />,
    );
    const divider = screen.getByTestId("divider");
    await user.click(tab("People"));
    expect(screen.getByTestId("divider")).toBe(divider);
    for (const panel of document.querySelectorAll("[role=tabpanel]")) {
      expect(panel).not.toContainElement(divider);
    }
  });

  /** @scenario Actions and the panel header sit outside the tablist */
  it("lists shortcuts as aria-keyshortcuts and draws them", () => {
    renderWithDesignSystem(<Harness tabs={items({ billing: { shortcut: "g b" } })} />);
    expect(tab("Billing")).toHaveAttribute("aria-keyshortcuts", "g b");
    expect(tab("Billing")).toHaveTextContent("g b");
  });
});
