/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  AutomationHistory,
  FIRES,
  GuidedSetup,
  type Fire,
  type LoadEarlier,
  type SaveAutomation,
  type SendTest,
} from "../src/workshop/guided-setup.example.tsx";
import { guidedSetupSource } from "../src/workshop/guided-setup.source.ts";
import * as guidedStories from "../src/workshop/guided-setup.stories.tsx";

beforeAll(() => {
  window.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  toaster.remove();
});

afterEach(() => {
  cleanup();
  toaster.remove();
});

function composedFor(mode: "light" | "dark") {
  return composeStories(guidedStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const drawer = (name: string) => screen.findByRole("dialog", { name });
const rail = () => screen.getByRole("navigation", { name: "Automation steps" });
const railItem = (label: string) => within(rail()).getByRole("button", { name: new RegExp(label) });
const threshold = () => screen.getByRole<HTMLInputElement>("textbox", { name: /Threshold/ });
const nameField = () => screen.getByRole<HTMLInputElement>("textbox", { name: /Name/ });
const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
const stepNote = (n: number) => screen.getByText(`Step ${n} of 3`);

const visibleStates = {
  Watch: async () => {
    await drawer("New automation");
    expect(stepNote(1)).toBeTruthy();
    expect(threshold().value).toBe("");
    expect(railItem("Watch").getAttribute("aria-current")).toBe("step");
    expect(railItem("Review").getAttribute("aria-disabled")).toBe("true");
    expect(button("Continue")).toBeTruthy();
  },
  Delivery: async () => {
    await drawer("New automation");
    expect(stepNote(2)).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(railItem("Delivery").getAttribute("aria-current")).toBe("step");
    expect(railItem("Watch").textContent).toContain("Trace cost above $0.50");
    expect(within(railItem("Watch")).getByText("complete")).toBeTruthy();
    expect(button("Back")).toBeTruthy();
  },
  Review: async () => {
    await drawer("New automation");
    expect(stepNote(3)).toBeTruthy();
    expect(screen.getByText("Fires when one trace's cost is above $0.50.")).toBeTruthy();
    expect(screen.getByText("Delivers to #support-alerts (Slack).")).toBeTruthy();
    expect(button("Create automation")).toBeTruthy();
    expect(button("Send test message")).toBeTruthy();
    expect(railItem("Review").getAttribute("aria-current")).toBe("step");
  },
  InvalidWatch: async () => {
    await drawer("New automation");
    expect(screen.getByText("Enter a threshold above 0 to continue.")).toBeTruthy();
    expect(threshold().getAttribute("aria-invalid")).toBe("true");
  },
  NoDestinations: async () => {
    await drawer("New automation");
    expect(screen.getByText("No delivery destinations yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open delivery settings" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
    expect(button("Continue").disabled).toBe(true);
    expect(screen.queryByRole("radio")).toBeNull();
  },
  Saving: async () => {
    const dialog = await drawer("New automation");
    const create = dialog.querySelector<HTMLButtonElement>('[data-frame-action="primary"]');
    expect(create?.disabled).toBe(true);
    expect(create?.hasAttribute("data-loading")).toBe(true);
    expect(create?.textContent).toBe("Create automation");
    expect(nameField().disabled).toBe(true);
  },
  SaveFailed: async () => {
    const dialog = await drawer("New automation");
    const alert = within(dialog).getByRole("alert");
    expect(within(alert).getByText("Couldn't save the automation")).toBeTruthy();
    expect(within(alert).getByText(/The automation service did not answer\./)).toBeTruthy();
    expect(nameField().value).toBe("High-cost traces");
  },
  EditExisting: async () => {
    await drawer("Edit automation");
    expect(nameField().value).toBe("Slow responses");
    expect(button("Save changes")).toBeTruthy();
    expect(screen.getByText("Fires when one trace's latency is above 8 seconds.")).toBeTruthy();
    expect(railItem("Watch").getAttribute("aria-disabled")).toBeNull();
    expect(railItem("Delivery").getAttribute("aria-disabled")).toBeNull();
  },
  Narrow: async () => {
    const frame = await screen.findByTitle("Guided setup at 390 pixels");
    expect(frame.getAttribute("src")).toContain("id=patterns-guided-setup--delivery");
    expect(getComputedStyle(frame).width).toBe("390px");
  },
  History: async () => {
    const dialog = await drawer("Slow responses");
    expect(within(dialog).getByRole("heading", { name: "History" })).toBeTruthy();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);
    expect(within(dialog).getByText("Showing 5 of 14 firings")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Load more" })).toBeTruthy();
  },
  HistoryLoadingMore: async () => {
    const dialog = await drawer("Slow responses");
    const more = dialog.querySelector<HTMLButtonElement>("button[data-loading]");
    expect(more?.disabled).toBe(true);
    expect(more?.textContent).toContain("Load more");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);
  },
  HistoryEnd: async () => {
    const dialog = await drawer("Slow responses");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(14);
    expect(within(dialog).getByText("Showing 14 of 14 firings")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
  },
};

describe("the Guided setup pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every guided setup story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

async function openNew({ user }: { user: ReturnType<typeof userEvent.setup> }) {
  await user.click(screen.getByRole("button", { name: "New automation" }));
  await drawer("New automation");
}

async function reachReview({
  user,
  amount = "0.5",
}: {
  user: ReturnType<typeof userEvent.setup>;
  amount?: string;
}) {
  await user.type(threshold(), amount);
  await user.click(button("Continue"));
  await user.click(await screen.findByRole("radio", { name: /#support-alerts/ }));
  await user.click(button("Continue"));
  await screen.findByRole("heading", { name: "Watches" });
}

describe("given the setup drawer on its first stage", () => {
  describe("when Continue is pressed with no threshold", () => {
    /** @scenario Continue without a threshold is refused under the field */
    it("says what is missing, focuses the field and stays on Watch", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<GuidedSetup />);
      await openNew({ user });
      await user.click(button("Continue"));

      expect(await screen.findByText("Enter a threshold above 0 to continue.")).toBeTruthy();
      expect(document.activeElement).toBe(threshold());
      expect(stepNote(1)).toBeTruthy();
    });
  });

  describe("when the threshold is set, the reader moves on and comes back", () => {
    /** @scenario Going back keeps the answers */
    it("finds the typed threshold still in the field", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<GuidedSetup />);
      await openNew({ user });
      await user.type(threshold(), "0.75");
      await user.click(button("Continue"));
      expect(await screen.findByRole("radio", { name: /Support on-call/ })).toBeTruthy();
      await user.click(button("Back"));

      expect(threshold().value).toBe("0.75");
      expect(stepNote(1)).toBeTruthy();
    });
  });

  describe("when a later stage is not yet reachable", () => {
    /** @scenario A stage that cannot be opened stays shut */
    it("ignores a click on Review and on Delivery until the answers before them exist", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<GuidedSetup />);
      await openNew({ user });
      await user.click(railItem("Review"));
      await user.click(railItem("Delivery"));
      expect(stepNote(1)).toBeTruthy();
      expect(railItem("Watch").getAttribute("aria-current")).toBe("step");

      await user.type(threshold(), "0.5");
      await user.click(button("Continue"));
      await user.click(button("Continue"));
      expect(
        await screen.findByText("Choose where this automation sends its alerts."),
      ).toBeTruthy();
      await user.click(railItem("Review"));
      expect(stepNote(2)).toBeTruthy();
      expect(railItem("Review").getAttribute("aria-disabled")).toBe("true");
    });
  });

  describe("when the reader uses only the keyboard", () => {
    /** @scenario The whole setup works from the keyboard */
    it("types, presses Enter, chooses with the arrow keys and reaches Review", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<GuidedSetup />);
      await openNew({ user });
      threshold().focus();
      await user.keyboard("0.5{Enter}");

      const first = await screen.findByRole<HTMLInputElement>("radio", { name: /#support-alerts/ });
      await waitFor(() => expect(document.activeElement).toBe(first));
      await user.keyboard(" ");
      expect(first.checked).toBe(true);
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole<HTMLInputElement>("radio", { name: /Support on-call/ }).checked).toBe(
        true,
      );
      button("Continue").focus();
      await user.keyboard("{Enter}");

      expect(await screen.findByText("Delivers to Support on-call (Email).")).toBeTruthy();
      railItem("Watch").focus();
      await user.keyboard("{Enter}");
      expect(threshold().value).toBe("0.5");
    });
  });
});

describe("given a drawer with no delivery destination", () => {
  /** @scenario With nowhere to deliver, Continue is off and says why */
  it("keeps Continue off, names the reason and gives two ways forward", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<GuidedSetup destinations={[]} />);
    await openNew({ user });
    await user.type(threshold(), "0.5");
    await user.click(button("Continue"));

    expect(await screen.findByText("No delivery destinations yet")).toBeTruthy();
    expect(screen.getByText(/Continue stays off until you connect one/)).toBeTruthy();
    expect(button("Continue").disabled).toBe(true);
    await user.click(button("Continue"));
    expect(stepNote(2)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open delivery settings" }).getAttribute("href")).toBe(
      "/settings/automations/destinations",
    );
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  });
});

describe("given the review stage", () => {
  describe("when an earlier answer is edited from Review", () => {
    /** @scenario Review shows the edited choices */
    it("goes back to the answer, keeps the rest and shows the new value on return", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<GuidedSetup />);
      await openNew({ user });
      await reachReview({ user });
      expect(screen.getByText("Fires when one trace's cost is above $0.5.")).toBeTruthy();

      await user.click(button("Edit what this automation watches"));
      expect(threshold().value).toBe("0.5");
      await user.clear(threshold());
      await user.type(threshold(), "0.75");
      await user.click(button("Continue"));
      expect(
        (await screen.findByRole<HTMLInputElement>("radio", { name: /#support-alerts/ })).checked,
      ).toBe(true);
      await user.click(button("Continue"));

      expect(await screen.findByText("Fires when one trace's cost is above $0.75.")).toBeTruthy();
      expect(screen.getByText("Delivers to #support-alerts (Slack).")).toBeTruthy();
    });
  });

  describe("when the test message is sent", () => {
    /** @scenario A test send reports its result */
    it("says it was sent, or says it failed and still allows creating", async () => {
      const user = userEvent.setup();
      let failures = 1;
      const sendTest: SendTest = () =>
        failures-- > 0
          ? Promise.reject(new Error("Slack refused the message."))
          : Promise.resolve();
      renderWithDesignSystem(<GuidedSetup sendTest={sendTest} />);
      await openNew({ user });
      await reachReview({ user });

      await user.click(button("Send test message"));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("The test message did not arrive")).toBeTruthy();
      expect(within(alert).getByText(/Slack refused the message\./)).toBeTruthy();
      expect(button("Create automation").disabled).toBe(false);

      await user.click(button("Send test message"));
      expect(await screen.findByText("Test message sent")).toBeTruthy();
      expect(screen.queryByText("The test message did not arrive")).toBeNull();
    });
  });

  describe("when the name is cleared and Create is pressed", () => {
    /** @scenario A missing name is said under the field */
    it("says the name is required, focuses it and saves nothing", async () => {
      const user = userEvent.setup();
      const saved: Parameters<SaveAutomation>[0][] = [];
      const saveAutomation: SaveAutomation = (args) => {
        saved.push(args);
        return Promise.resolve();
      };
      renderWithDesignSystem(<GuidedSetup saveAutomation={saveAutomation} />);
      await openNew({ user });
      await reachReview({ user });
      await user.clear(nameField());
      await user.click(button("Create automation"));

      expect(await screen.findByText("Name is required")).toBeTruthy();
      expect(document.activeElement).toBe(nameField());
      expect(saved).toEqual([]);
    });
  });

  describe("when a save is refused once", () => {
    /** @scenario A refused save keeps every answer and can be retried */
    it("keeps the answers, then adds the automation on the second try", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const saved: Parameters<SaveAutomation>[0][] = [];
      const saveAutomation: SaveAutomation = (args) => {
        if (refusals-- > 0)
          return Promise.reject(new Error("The automation service did not answer."));
        saved.push(args);
        return Promise.resolve();
      };
      renderWithDesignSystem(<GuidedSetup saveAutomation={saveAutomation} />);
      await openNew({ user });
      await reachReview({ user });
      await user.click(button("Create automation"));

      const alert = await screen.findByRole("alert");
      expect(within(alert).getByText("Couldn't save the automation")).toBeTruthy();
      expect(nameField().value).toBe("High-cost traces");
      expect(screen.getByText("Fires when one trace's cost is above $0.5.")).toBeTruthy();
      expect(saved).toEqual([]);

      await user.click(button("Create automation"));
      expect(await screen.findByText("Automation created")).toBeTruthy();
      expect(saved).toEqual([
        {
          draft: {
            name: "High-cost traces",
            subject: "cost",
            threshold: "0.5",
            destination: "slack-support",
          },
        },
      ]);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      const list = within(screen.getByRole("list", { name: "Automations" }));
      expect(list.getByText("High-cost traces")).toBeTruthy();
      expect(list.getByText("Trace cost above $0.5")).toBeTruthy();
    });
  });
});

describe("given a saved automation", () => {
  /** @scenario A saved automation keeps what it watches and changes the rest */
  it("locks the subject, lets the threshold change and updates the row", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<GuidedSetup />);
    await user.click(screen.getByRole("button", { name: "Edit Slow responses" }));
    await drawer("Edit automation");
    expect(railItem("Review").getAttribute("aria-current")).toBe("step");

    await user.click(button("Edit what this automation watches"));
    const subject = screen.getByRole<HTMLSelectElement>("combobox", { name: /What to watch/ });
    expect(subject.disabled).toBe(true);
    expect(screen.getByText(/cannot be changed once it is saved/)).toBeTruthy();
    await user.clear(threshold());
    await user.type(threshold(), "10");
    await user.click(railItem("Review"));
    await user.click(button("Save changes"));

    expect(await screen.findByText("Automation updated")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Trace latency above 10 seconds")).toBeTruthy();
    expect(screen.getAllByText("Slow responses").length).toBeGreaterThan(0);
  });
});

const firesAt = ({ from, to }: { from: number; to: number }): Fire[] => FIRES.slice(from, to);

function traceIds(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole("listitem")
    .map((item) => /tr_[0-9a-f]+/.exec(item.textContent ?? "")?.[0] ?? "");
}

describe("given the firing history", () => {
  describe("when Load more is pressed", () => {
    /** @scenario Load more adds older firings under the ones shown */
    it("appends the next page, keeps the shown rows and the order, then removes the action", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<AutomationHistory />);
      const dialog = await drawer("Slow responses");
      const before = within(dialog).getAllByRole("listitem");
      expect(traceIds(dialog)).toEqual(FIRES.slice(0, 5).map((fire) => fire.traceId));

      await user.click(within(dialog).getByRole("button", { name: "Load more" }));
      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(10));
      const after = within(dialog).getAllByRole("listitem");
      before.forEach((row, index) => expect(after[index]).toBe(row));
      expect(traceIds(dialog)).toEqual(FIRES.slice(0, 10).map((fire) => fire.traceId));
      expect(within(dialog).getByText("Showing 10 of 14 firings")).toBeTruthy();

      await user.click(within(dialog).getByRole("button", { name: "Load more" }));
      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(14));
      expect(traceIds(dialog)).toEqual(FIRES.map((fire) => fire.traceId));
      expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
      expect(within(dialog).getByText("Showing 14 of 14 firings")).toBeTruthy();
    });
  });

  describe("when an older page repeats a firing already shown", () => {
    /** @scenario A repeated firing is shown once */
    it("lists each firing once", async () => {
      const user = userEvent.setup();
      const loadEarlier: LoadEarlier = () =>
        Promise.resolve({ fires: firesAt({ from: 3, to: 8 }), total: FIRES.length });
      renderWithDesignSystem(<AutomationHistory loadEarlier={loadEarlier} />);
      const dialog = await drawer("Slow responses");
      await user.click(within(dialog).getByRole("button", { name: "Load more" }));

      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(8));
      const ids = traceIds(dialog);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("when loading an older page fails", () => {
    /** @scenario A failed older page keeps the rows and can be retried */
    it("says so, keeps the rows and loads on Try again", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const loadEarlier: LoadEarlier = ({ loaded }) =>
        refusals-- > 0
          ? Promise.reject(new Error("The history service did not answer."))
          : Promise.resolve({ fires: FIRES.slice(loaded, loaded + 5), total: FIRES.length });
      renderWithDesignSystem(<AutomationHistory loadEarlier={loadEarlier} />);
      const dialog = await drawer("Slow responses");
      await user.click(within(dialog).getByRole("button", { name: "Load more" }));

      const alert = await within(dialog).findByRole("alert");
      expect(within(alert).getByText("Couldn't load earlier firings")).toBeTruthy();
      expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);

      await user.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(10));
      expect(within(dialog).queryByRole("alert")).toBeNull();
    });
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...guidedSetupSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(10);
    for (const specifier of specifiers) {
      // `@langwatch/time` is the house clock, which the time lint rules require.
      const allowed =
        specifier === "react" ||
        specifier === "@langwatch/time" ||
        specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
