/** @vitest-environment jsdom */
import { toaster } from "@langwatch/design-system/toaster";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  ApiKeyFlow,
  FAKE_TOKEN,
  type CreateKey,
  type WriteToClipboard,
} from "../src/workshop/api-key-flow.example.tsx";
import * as apiKeyStories from "../src/workshop/api-key-flow.stories.tsx";

/** The example's own text, so the docs show exactly the file that renders. */
const files = import.meta.glob("../src/workshop/api-key-flow.example.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});
const apiKeyFlowSource = Object.values(files).map(String).join("");

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

/** jsdom lays nothing out, so the focus trap would treat every element as hidden. */
function stubLayout() {
  const rect = new DOMRect(0, 0, 10, 10);
  const rects: DOMRectList = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: () => [rect][Symbol.iterator](),
  };
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue(rects);
}

beforeEach(() => {
  toaster.remove();
  stubLayout();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  toaster.remove();
  window.getSelection()?.removeAllRanges();
});

function composedFor(mode: "light" | "dark") {
  return composeStories(apiKeyStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

/** The secret may reach the page only through a deliberate reveal. */
function expectNoSecretOnPage() {
  expect(document.body.textContent).not.toContain(FAKE_TOKEN);
  expect(document.body.innerHTML).not.toContain(FAKE_TOKEN);
}

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { name: "API keys" })).toBeTruthy();
    expect(screen.getByText("sk-lw-7f3a9c…")).toBeTruthy();
    expect(screen.getByText("sk-lw-2d81e4…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create new secret key" })).toBeTruthy();
    expectNoSecretOnPage();
  },
  CreateOpen: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    expect(within(drawer).getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(within(drawer).getByRole("combobox", { name: "Expiration" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Create secret key" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    const ids = [...drawer.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  },
  MissingName: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    expect(within(drawer).getByText("Enter a name for this key.")).toBeTruthy();
    expect(within(drawer).getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
  },
  ExpiryUnchosen: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    expect(
      within(drawer).getByText("Choose when this key expires, or select No expiration."),
    ).toBeTruthy();
    expect(
      within(drawer).getByRole<HTMLSelectElement>("combobox", { name: "Expiration" }).value,
    ).toBe("");
  },
  NoScope: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    expect(within(drawer).getByText("Choose where this key can be used.")).toBeTruthy();
  },
  Creating: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    const create = within(drawer).getByRole<HTMLButtonElement>("button", {
      name: "Create secret key",
    });
    expect(create.disabled).toBe(true);
    expect(create.hasAttribute("data-loading")).toBe(true);
    expect(create.getAttribute("aria-busy")).toBe("true");
    expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).disabled).toBe(
      true,
    );
  },
  CreateFailed: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
    const alert = within(drawer).getByRole("alert");
    expect(within(alert).getByText("Couldn't create the key")).toBeTruthy();
    expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
      "Release pipeline",
    );
  },
  Reveal: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(dialog).getByRole("button", { name: "Copy API key" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(dialog).getByText("sk-lw-••••0000")).toBeTruthy();
    expect(within(dialog).getByRole("tab", { name: ".env" })).toBeTruthy();
    expect(within(dialog).getByRole("tab", { name: "Bearer" })).toBeTruthy();
    expect(within(dialog).getByRole("combobox", { name: "Project" })).toBeTruthy();
    expectNoSecretOnPage();
  },
  RevealOneProject: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(dialog).queryByRole("combobox", { name: "Project" })).toBeNull();
    expect(within(dialog).getByText("Support assistant")).toBeTruthy();
    expectNoSecretOnPage();
  },
  RevealNoProject: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(dialog).getByText(/No project is reachable with this key/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Copy API key" })).toBeTruthy();
    expectNoSecretOnPage();
  },
  Copied: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Copy API key" })).toBeNull();
  },
  CopyFailed: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    const alert = within(dialog).getByRole("alert");
    expect(within(alert).getByText("Couldn't copy to the clipboard.")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Select the key" })).toBeTruthy();
    expectNoSecretOnPage();
  },
  Closed: async () => {
    expect(await screen.findByText("Release pipeline")).toBeTruthy();
    expect(screen.getAllByText("sk-lw-a1b2c3…")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expectNoSecretOnPage();
  },
  Empty: async () => {
    expect(await screen.findByText(/No API keys yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about API keys" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  },
  Narrow: async () => {
    expect(await screen.findByRole("heading", { name: "API keys" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "API keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create new secret key" })).toBeTruthy();
  },
};

describe("the API key create and reveal pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every API key story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

type User = ReturnType<typeof userEvent.setup>;

async function fillForm({ user, name }: { user: User; name: string }) {
  await user.click(screen.getByRole("button", { name: "Create new secret key" }));
  const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
  await user.type(within(drawer).getByRole("textbox", { name: "Name" }), name);
  await user.selectOptions(within(drawer).getByRole("combobox", { name: "Expiration" }), "30");
  return drawer;
}

async function createKey({ user, name }: { user: User; name: string }) {
  const drawer = await fillForm({ user, name });
  await user.click(within(drawer).getByRole("button", { name: "Create secret key" }));
  return screen.findByRole("dialog", { name: "Token created" });
}

function rendered(props: { copyToClipboard?: WriteToClipboard; create?: CreateKey } = {}) {
  return renderWithDesignSystem(<ApiKeyFlow {...props} />);
}

describe("given the API key list", () => {
  describe("when the reader creates a key", () => {
    /** @scenario Creating a key opens a named reveal with focus inside it */
    it("closes the form, opens the reveal on Copy API key and lists the prefix", async () => {
      const user = userEvent.setup();
      rendered();
      const reveal = await createKey({ user, name: "Release pipeline" });

      await waitFor(() =>
        expect(document.activeElement).toBe(
          within(reveal).getByRole("button", { name: "Copy API key" }),
        ),
      );
      expect(screen.queryByRole("dialog", { name: "Create new secret key" })).toBeNull();
      const list = within(screen.getByRole("table", { hidden: true }));
      expect(list.getByText("sk-lw-a1b2c3…")).toBeTruthy();
      expect(list.getByText("Release pipeline")).toBeTruthy();
      expectNoSecretOnPage();
    });
  });

  describe("when the reader presses Create with nothing filled in", () => {
    /** @scenario A form with missing choices names them and focuses the first */
    it("names what is missing, focuses the name and creates nothing", async () => {
      const user = userEvent.setup();
      const create = vi.fn<CreateKey>();
      rendered({ create });
      await user.click(screen.getByRole("button", { name: "Create new secret key" }));
      const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
      await user.click(within(drawer).getByRole("button", { name: "Create secret key" }));

      expect(await within(drawer).findByText("Enter a name for this key.")).toBeTruthy();
      expect(document.activeElement).toBe(within(drawer).getByRole("textbox", { name: "Name" }));
      expect(create).not.toHaveBeenCalled();
      expect(screen.getAllByRole("row")).toHaveLength(3);
    });
  });

  describe("when the reader forgets the expiry", () => {
    /** @scenario A missing expiry is a choice the reader must make */
    it("asks for a date or No expiration and focuses the field", async () => {
      const user = userEvent.setup();
      rendered();
      await user.click(screen.getByRole("button", { name: "Create new secret key" }));
      const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
      await user.type(within(drawer).getByRole("textbox", { name: "Name" }), "CI pipeline");
      await user.click(within(drawer).getByRole("button", { name: "Create secret key" }));

      expect(
        await within(drawer).findByText("Choose when this key expires, or select No expiration."),
      ).toBeTruthy();
      expect(document.activeElement).toBe(
        within(drawer).getByRole("combobox", { name: "Expiration" }),
      );
      await user.selectOptions(
        within(drawer).getByRole("combobox", { name: "Expiration" }),
        "never",
      );
      expect(
        within(drawer).queryByText("Choose when this key expires, or select No expiration."),
      ).toBeNull();
    });
  });

  describe("when a create is refused once", () => {
    /** @scenario A refused create keeps the draft and can be retried */
    it("keeps what was entered, then opens the reveal on the second try", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const create: CreateKey = () => {
        if (refusals-- > 0) return Promise.reject(new Error("The key service did not answer."));
        return Promise.resolve({ token: FAKE_TOKEN, prefix: "sk-lw-a1b2c3…" });
      };
      rendered({ create });
      const drawer = await fillForm({ user, name: "Release pipeline" });
      await user.click(within(drawer).getByRole("button", { name: "Create secret key" }));

      expect(await within(drawer).findByText("Couldn't create the key")).toBeTruthy();
      expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
        "Release pipeline",
      );
      expect(screen.getAllByRole("row")).toHaveLength(3);

      await user.click(within(drawer).getByRole("button", { name: "Create secret key" }));
      expect(await screen.findByRole("dialog", { name: "Token created" })).toBeTruthy();
    });
  });
});

describe("given the reveal for a new key", () => {
  describe("when the reader copies the key", () => {
    /** @scenario Copying writes the real key and shows only a mask */
    it("writes the whole key, reads Copied and never shows the key unmasked", async () => {
      const user = userEvent.setup();
      const copyToClipboard = vi.fn<WriteToClipboard>().mockResolvedValue(undefined);
      rendered({ copyToClipboard });
      const reveal = await createKey({ user, name: "Release pipeline" });
      await user.click(within(reveal).getByRole("button", { name: "Copy API key" }));

      expect(copyToClipboard).toHaveBeenCalledExactlyOnceWith(FAKE_TOKEN);
      expect(await within(reveal).findByRole("button", { name: "Copied" })).toBeTruthy();
      expect(await screen.findByText("API key copied to clipboard")).toBeTruthy();
      expect(within(reveal).getByText("sk-lw-••••0000")).toBeTruthy();
      expectNoSecretOnPage();
    });
  });

  describe("when the reader copies the .env snippet", () => {
    /** @scenario Copying a snippet writes the real key inside it */
    it("writes the snippet with the whole key and the project while the screen stays masked", async () => {
      const user = userEvent.setup();
      const copyToClipboard = vi.fn<WriteToClipboard>().mockResolvedValue(undefined);
      rendered({ copyToClipboard });
      const reveal = await createKey({ user, name: "Release pipeline" });
      await user.click(await within(reveal).findByRole("button", { name: "Copy .env" }));

      const [written] = copyToClipboard.mock.calls[0] ?? [];
      expect(written).toContain(`LANGWATCH_API_KEY="${FAKE_TOKEN}"`);
      expect(written).toContain('LANGWATCH_PROJECT_ID="proj-support"');
      expectNoSecretOnPage();
    });
  });

  describe("when the clipboard refuses", () => {
    /** @scenario A refused copy claims nothing and offers manual selection */
    it("says the copy failed, shows no success and selects the key on request", async () => {
      const user = userEvent.setup();
      const copyToClipboard = vi.fn<WriteToClipboard>().mockRejectedValue(new Error("denied"));
      rendered({ copyToClipboard });
      const reveal = await createKey({ user, name: "Release pipeline" });
      await user.click(within(reveal).getByRole("button", { name: "Copy API key" }));

      const alert = await within(reveal).findByRole("alert");
      expect(within(alert).getByText("Couldn't copy to the clipboard.")).toBeTruthy();
      expect(within(reveal).queryByRole("button", { name: "Copied" })).toBeNull();
      expect(screen.queryByText("API key copied to clipboard")).toBeNull();
      expectNoSecretOnPage();

      await user.click(within(alert).getByRole("button", { name: "Select the key" }));
      expect(await within(reveal).findByText(FAKE_TOKEN)).toBeTruthy();
      await waitFor(() => expect(window.getSelection()?.toString()).toBe(FAKE_TOKEN));
    });
  });

  describe.each([
    ["Done", async (user: User) => user.click(screen.getByRole("button", { name: "Done" }))],
    ["Escape", async (user: User) => user.keyboard("{Escape}")],
    ["the X", async (user: User) => user.click(screen.getByRole("button", { name: "Close" }))],
  ] as const)("when the reader closes it with %s", (_way, close) => {
    /** @scenario Done, Escape and the X all clear the key */
    it("leaves no trace of the key and opens the next form empty", async () => {
      const user = userEvent.setup();
      rendered();
      const reveal = await createKey({ user, name: "Release pipeline" });
      await user.click(within(reveal).getByRole("button", { name: "Show key" }));
      expect(await within(reveal).findByText(FAKE_TOKEN)).toBeTruthy();

      await close(user);

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expectNoSecretOnPage();
      expect(screen.getByText("sk-lw-a1b2c3…")).toBeTruthy();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Create new secret key" }),
        ),
      );

      await user.click(screen.getByRole("button", { name: "Create new secret key" }));
      const drawer = await screen.findByRole("dialog", { name: "Create new secret key" });
      expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
        "",
      );
      expectNoSecretOnPage();
    });
  });
});

describe("given a reveal for a key that reaches different projects", () => {
  /** @scenario The snippet names the projects the key can reach */
  it("offers a choice for several, names one outright and explains when there is none", async () => {
    const Several = composedFor("light").Reveal;
    const { unmount } = render(<Several />);
    const dialog = await screen.findByRole("dialog", { name: "Token created" });
    const choice = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Project" });
    expect(
      within(choice)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Support assistant", "Billing assistant"]);
    unmount();
    cleanup();

    const One = composedFor("light").RevealOneProject;
    render(<One />);
    const sole = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(sole).queryByRole("combobox", { name: "Project" })).toBeNull();
    expect(within(sole).getByText("Support assistant")).toBeTruthy();
    cleanup();

    const None = composedFor("light").RevealNoProject;
    render(<None />);
    const empty = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(empty).getByText(/No project is reachable with this key/)).toBeTruthy();
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...apiKeyFlowSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(10);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
