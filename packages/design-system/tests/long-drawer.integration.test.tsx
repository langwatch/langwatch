/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import * as drawerStories from "../src/workshop/drawer-with-form.stories.tsx";
import {
  type AgentDraft,
  LongDrawer,
  type SaveAgent,
  type TestAgent,
} from "../src/workshop/long-drawer.example.tsx";
import { longDrawerSource } from "../src/workshop/long-drawer.source.ts";

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
  return composeStories(drawerStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const drawer = () => screen.findByRole("dialog", { name: "Edit HTTP agent" });
const nameField = () => screen.getByRole<HTMLInputElement>("textbox", { name: /^Agent name/ });
const urlField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "URL" });
const saveButton = () => document.querySelector<HTMLButtonElement>('[data-frame-action="primary"]');

const visibleStates = {
  Default: async () => {
    const dialog = await drawer();
    expect(nameField().value).toBe("Support HTTP agent");
    expect(urlField().value).toBe("https://api.example.com/support/chat");
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Test connection" })).toBeTruthy();
    const tabs = within(dialog).getByRole("tablist", { name: "Request settings" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Body", "Auth", "Headers 2", "Test"]);
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
  },
  LongBody: async () => {
    const dialog = await drawer();
    const body = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
      name: /^Request body/,
    });
    expect(body.value.split("\n").length).toBeGreaterThan(30);
    expect(body.value).toContain('"agent": "support-http-agent"');
    expect(within(dialog).getByRole("tab", { name: "Headers14" })).toBeTruthy();
  },
  InvalidUrl: async () => {
    await drawer();
    expect(await screen.findByText("Enter a full URL, starting with https://")).toBeTruthy();
    expect(urlField().getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(urlField()));
  },
  Saving: async () => {
    const dialog = await drawer();
    const save = saveButton();
    expect(save?.disabled).toBe(true);
    expect(save?.hasAttribute("data-loading")).toBe(true);
    expect(save?.textContent).toBe("Save changes");
    expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(
      true,
    );
    expect(nameField().disabled).toBe(true);
    expect(nameField().value).toBe("Support HTTP agent (EU)");
  },
  SaveFailed: async () => {
    const dialog = await drawer();
    const alert = within(dialog).getByRole("alert");
    expect(within(alert).getByText("Couldn't save the agent")).toBeTruthy();
    expect(within(alert).getByText(/The agent service did not answer\./)).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "Agent troubleshooting" })).toBeTruthy();
    expect(nameField().value).toBe("Support HTTP agent (EU)");
  },
  TestFailed: async () => {
    const dialog = await drawer();
    expect(within(dialog).getByRole("tab", { name: "Test" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    const alert = await within(dialog).findByRole("alert");
    expect(within(alert).getByText("Couldn't reach the endpoint")).toBeTruthy();
    expect(within(alert).getByText(/The request timed out after 30 seconds\./)).toBeTruthy();
    expect(within(alert).getByRole("link", { name: "Connection troubleshooting" })).toBeTruthy();
  },
  ReadOnly: async () => {
    const dialog = await drawer();
    expect(within(dialog).getByText("Only project admins can change this agent")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "About roles and access" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(nameField().readOnly).toBe(true);
    expect(urlField().readOnly).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Test connection" })).toBeTruthy();
  },
  Narrow: async () => {
    const frame = await screen.findByTitle("Drawer with form at 390 pixels");
    expect(frame.getAttribute("src")).toContain("id=patterns-drawer-with-form--default");
    expect(frame.getAttribute("src")).toContain(":");
    expect(getComputedStyle(frame).width).toBe("390px");
  },
};

describe("the Drawer with form pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every drawer story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

function recordingSave(): { save: SaveAgent; saved: AgentDraft[] } {
  const saved: AgentDraft[] = [];
  return {
    saved,
    save: (draft) => {
      saved.push(draft);
      return Promise.resolve();
    },
  };
}

describe("given the agent open for editing", () => {
  describe("when the reader edits a late field, changes tab and comes back", () => {
    /** @scenario A tab keeps what was typed in it */
    it("keeps the edits made on every tab", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<LongDrawer />);
      const dialog = await drawer();

      await user.click(within(dialog).getByRole("tab", { name: "Headers2" }));
      const accept = await within(dialog).findByRole<HTMLInputElement>("textbox", {
        name: "Header 2 value",
      });
      await user.clear(accept);
      await user.type(accept, "text/plain");
      await user.click(within(dialog).getByRole("button", { name: "Add header" }));
      await user.type(
        await within(dialog).findByRole("textbox", { name: "Header 3 name" }),
        "X-Region",
      );
      await user.click(within(dialog).getByRole("tab", { name: "Body" }));
      const path = within(dialog).getByRole<HTMLInputElement>("textbox", {
        name: /^Response path/,
      });
      await user.clear(path);
      await user.type(path, "$.answer");
      await user.click(within(dialog).getByRole("tab", { name: "Auth" }));
      await user.click(within(dialog).getByRole("tab", { name: "Headers3" }));

      expect(
        within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Header 2 value" }).value,
      ).toBe("text/plain");
      expect(
        within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Header 3 name" }).value,
      ).toBe("X-Region");
      await user.click(within(dialog).getByRole("tab", { name: "Body" }));
      expect(
        within(dialog).getByRole<HTMLInputElement>("textbox", { name: /^Response path/ }).value,
      ).toBe("$.answer");
    });
  });

  describe("when the reader saves", () => {
    let user: ReturnType<typeof userEvent.setup>;
    let saved: AgentDraft[];

    beforeEach(async () => {
      user = userEvent.setup();
      const recording = recordingSave();
      saved = recording.saved;
      renderWithDesignSystem(<LongDrawer save={recording.save} />);
      await drawer();
    });

    /** @scenario Save changes submits the form once */
    it("stores the draft once, closes the drawer and shows the new name", async () => {
      await user.clear(nameField());
      await user.type(nameField(), "Support HTTP agent (EU)");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Agent saved")).toBeTruthy();
      expect(saved).toHaveLength(1);
      expect(saved[0]?.name).toBe("Support HTTP agent (EU)");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(screen.getByText("Support HTTP agent (EU)")).toBeTruthy();
    });

    /** @scenario Enter in a field submits the form once */
    it("submits once when Enter is pressed in the name field", async () => {
      await user.type(nameField(), " (EU){Enter}");

      await waitFor(() => expect(saved).toHaveLength(1));
      expect(saved[0]?.name).toBe("Support HTTP agent (EU)");
    });
  });

  describe("when the URL is not a full URL", () => {
    /** @scenario An invalid URL is said under the field */
    it("says what is wrong, focuses the URL and stores nothing", async () => {
      const user = userEvent.setup();
      const { save, saved } = recordingSave();
      renderWithDesignSystem(<LongDrawer save={save} />);
      await drawer();
      await user.clear(urlField());
      await user.type(urlField(), "api.example.com");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Enter a full URL, starting with https://")).toBeTruthy();
      expect(document.activeElement).toBe(urlField());
      expect(saved).toHaveLength(0);
    });

    /** @scenario A missing name is said under the field */
    it("focuses the name first when it is empty too", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<LongDrawer />);
      await drawer();
      await user.clear(nameField());
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Enter a name for this agent.")).toBeTruthy();
      expect(document.activeElement).toBe(nameField());
    });
  });

  describe("when a save is refused once", () => {
    /** @scenario A refused save keeps every edit */
    it("keeps the edits on every tab, then saves on the second try", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const save: SaveAgent = () =>
        refusals-- > 0
          ? Promise.reject(new Error("The agent service did not answer."))
          : Promise.resolve();
      renderWithDesignSystem(<LongDrawer save={save} />);
      const dialog = await drawer();
      await user.type(nameField(), " (EU)");
      await user.click(within(dialog).getByRole("tab", { name: "Headers2" }));
      await user.clear(await within(dialog).findByRole("textbox", { name: "Header 1 value" }));
      await user.type(within(dialog).getByRole("textbox", { name: "Header 1 value" }), "billing");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      const alert = await within(dialog).findByRole("alert");
      expect(within(alert).getByText("Couldn't save the agent")).toBeTruthy();
      expect(nameField().value).toBe("Support HTTP agent (EU)");
      expect(
        within(dialog).getByRole<HTMLInputElement>("textbox", { name: "Header 1 value" }).value,
      ).toBe("billing");

      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByText("Agent saved")).toBeTruthy();
    });
  });

  describe("when the reader tests the connection", () => {
    /** @scenario Test connection shows the answer in the Test tab */
    it("opens the Test tab with the status and what the response path returned", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<LongDrawer />);
      const dialog = await drawer();
      await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

      expect(await within(dialog).findByText("Responded 200 in 412 ms")).toBeTruthy();
      expect(within(dialog).getByRole("tab", { name: "Test" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(
        within(dialog).getByText(/returned “Refunds go back to the original card/),
      ).toBeTruthy();
    });

    /** @scenario A connection that fails says why and what to check */
    it("says the endpoint could not be reached and keeps the form as it was", async () => {
      const user = userEvent.setup();
      const test: TestAgent = () => Promise.reject(new Error("Connection refused."));
      renderWithDesignSystem(<LongDrawer test={test} />);
      const dialog = await drawer();
      await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

      const alert = await within(dialog).findByRole("alert");
      expect(within(alert).getByText("Couldn't reach the endpoint")).toBeTruthy();
      expect(within(alert).getByText(/Connection refused\./)).toBeTruthy();
      expect(nameField().value).toBe("Support HTTP agent");
    });

    /** @scenario Test connection waits for a URL */
    it("is disabled while there is no URL", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<LongDrawer />);
      const dialog = await drawer();
      await user.clear(urlField());

      expect(
        within(dialog).getByRole<HTMLButtonElement>("button", { name: "Test connection" }).disabled,
      ).toBe(true);
    });
  });

  describe("when the reader closes the drawer", () => {
    /** @scenario Cancel and Escape close the drawer and discard the draft */
    it.each(["Cancel", "Escape"])(
      "%s closes it, returns focus and drops the edits",
      async (how) => {
        const user = userEvent.setup();
        const { save, saved } = recordingSave();
        renderWithDesignSystem(<LongDrawer save={save} />);
        const dialog = await drawer();
        await user.type(nameField(), " (draft)");
        if (how === "Cancel")
          await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        else await user.keyboard("{Escape}");

        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        const edit = screen.getByRole("button", { name: "Edit agent" });
        await waitFor(() => expect(document.activeElement).toBe(edit));
        expect(saved).toHaveLength(0);

        await user.click(edit);
        await drawer();
        expect(nameField().value).toBe("Support HTTP agent");
      },
    );
  });
});

describe("given someone who cannot change the agent", () => {
  /** @scenario Read-only shows the values and still allows a test */
  it("tests the connection without being able to save", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<LongDrawer start={{ readOnly: true }} />);
    const dialog = await drawer();
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(await within(dialog).findByText("Responded 200 in 412 ms")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).toBeNull();
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...longDrawerSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(10);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
