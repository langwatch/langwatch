/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import { ResourceDetail } from "../src/workshop/resource-detail.example.tsx";
import { resourceDetailSource } from "../src/workshop/resource-detail.source.ts";
import * as detailStories from "../src/workshop/resource-detail.stories.tsx";

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

afterEach(() => {
  cleanup();
});

function composedFor(mode: "light" | "dark") {
  return composeStories(detailStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const NAME = "Production support key";
const LONG_NAME =
  "Production support assistant key for the customer-facing escalation workflow, rotated every quarter";

function statusOf(): string | null {
  const identity = screen.getByRole("heading", { name: "Identity" }).closest("[data-card-variant]");
  const label = within(identity as HTMLElement).getByText("Status");
  return label.nextElementSibling?.textContent ?? null;
}

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: NAME })).toBeTruthy();
    expect(statusOf()).toBe("active");
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Python", selected: true })).toBeTruthy();
  },
  Disabled: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: NAME })).toBeTruthy();
    expect(statusOf()).toBe("disabled");
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
  },
  DisableConfirm: async () => {
    const dialog = await screen.findByRole("dialog", { name: `Disable ${NAME}?` });
    expect(within(dialog).getByRole("button", { name: "Disable key" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByText(/enable restores it exactly/)).toBeTruthy();
  },
  RevokeConfirm: async () => {
    const dialog = await screen.findByRole("alertdialog", { name: `Revoke ${NAME}?` });
    expect(within(dialog).getByRole("button", { name: "Revoke key" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByText(/This cannot be undone/)).toBeTruthy();
  },
  Revoked: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: NAME })).toBeTruthy();
    expect(statusOf()).toBe("revoked");
    expect(screen.getByRole("link", { name: "Audit history" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
  },
  Loading: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: "Virtual key" })).toBeTruthy();
    const loading = screen.getByRole("status", { name: "Loading virtual key" });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  },
  Failed: async () => {
    expect(await screen.findByText("Couldn't load this virtual key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to virtual keys" })).toBeTruthy();
  },
  Missing: async () => {
    expect(await screen.findByText("Virtual key not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to virtual keys" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  },
  LongName: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: LONG_NAME })).toBeTruthy();
    const identity = screen
      .getByRole("heading", { name: "Identity" })
      .closest("[data-card-variant]");
    expect(within(identity as HTMLElement).getByText(LONG_NAME)).toBeTruthy();
  },
  Narrow: async () => {
    expect(await screen.findByRole("heading", { level: 1, name: NAME })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Snippet language" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Scope & routing" })).toBeTruthy();
  },
};

describe("the Resource detail pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every virtual key story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

describe("given the usage example", () => {
  /** @scenario The snippet language changes from the keyboard */
  it("switches language with the arrow key and copies the snippet it shows", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceDetail />);
    const python = await screen.findByRole("tab", { name: "Python" });
    await user.click(python);
    await waitFor(() =>
      expect(screen.getByRole("tabpanel").textContent).toContain("from openai import OpenAI"),
    );

    await user.keyboard("{ArrowRight}");

    expect(await screen.findByRole("tab", { name: "TypeScript", selected: true })).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("tabpanel").textContent).toContain('import OpenAI from "openai"'),
    );
    await user.click(screen.getByRole("button", { name: "Copy code" }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('import OpenAI from "openai"');
    expect(copied).not.toContain("from openai import OpenAI");
  });

  /** @scenario The snippet never carries the secret */
  it("shows the prefix and reads the secret from the environment", async () => {
    renderWithDesignSystem(<ResourceDetail />);
    expect(await screen.findByText("lw_vk_7Hq2…")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole("tabpanel").textContent).toContain("$LANGWATCH_VK_SECRET"),
    );
    expect(document.body.textContent).not.toMatch(/lw_vk_[A-Za-z0-9]{8,}/);
  });
});

describe("given an active key", () => {
  /** @scenario Disabling and enabling a key changes its status */
  it("disables it after the confirmation and enables it again", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceDetail />);
    await user.click(await screen.findByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("dialog", { name: `Disable ${NAME}?` });
    await user.click(within(dialog).getByRole("button", { name: "Disable key" }));

    await waitFor(() => expect(statusOf()).toBe("disabled"));
    const enable = await screen.findByRole("button", { name: "Enable" });
    await waitFor(() => expect(document.activeElement).toBe(enable));

    await user.click(enable);
    await waitFor(() => expect(statusOf()).toBe("active"));
    expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
  });

  /** @scenario Cancelling a revoke keeps the key */
  it("keeps the key active when the revoke is cancelled", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceDetail />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog", { name: `Revoke ${NAME}?` });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(statusOf()).toBe("active");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  /** @scenario Confirming a revoke ends the key */
  it("revokes the key, removes the actions and moves focus to Audit history", async () => {
    const user = userEvent.setup();
    renderWithDesignSystem(<ResourceDetail />);
    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog", { name: `Revoke ${NAME}?` });
    await user.click(within(dialog).getByRole("button", { name: "Revoke key" }));

    await waitFor(() => expect(statusOf()).toBe("revoked"));
    for (const name of ["Disable", "Enable", "Revoke"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    const audit = screen.getByRole("link", { name: "Audit history" });
    await waitFor(() => expect(document.activeElement).toBe(audit));
  });
});

describe("given a key that is missing or failed to load", () => {
  /** @scenario A missing or failed key leads back to the list */
  it("reports the list address, and Try again shows the key", async () => {
    const user = userEvent.setup();
    const visited: string[] = [];
    renderWithDesignSystem(
      <ResourceDetail start={{ view: "failed" }} onNavigate={({ href }) => visited.push(href)} />,
    );
    await user.click(await screen.findByRole("link", { name: "Back to virtual keys" }));
    expect(visited).toEqual(["/gateway/virtual-keys"]);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: NAME })).toBeTruthy();
  });
});

describe("given a key with no usage", () => {
  /** @scenario A key without requests explains its empty usage */
  it("says there are no requests yet and links to sending one", async () => {
    renderWithDesignSystem(<ResourceDetail start={{ key: { usage: [], lastUsed: null } }} />);
    expect(await screen.findByText("No requests yet")).toBeTruthy();
    const docs = screen.getByRole("link", { name: /Send a first request/ });
    expect(docs.getAttribute("href")).toMatch(/^https:\/\/docs\.langwatch\.ai\//);
    expect(screen.getByText("Never")).toBeTruthy();
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...resourceDetailSource.matchAll(/^import [^;]*? from "([^"]+)";/gm)].map(
      (match) => match[1],
    );
    expect(specifiers.length).toBeGreaterThan(5);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
