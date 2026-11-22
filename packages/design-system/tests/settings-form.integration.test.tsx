/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { toaster } from "../src/components/overlays/toaster.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  SettingsForm,
  type SaveOrganization,
  type SavePresence,
} from "../src/workshop/settings-form.example.tsx";
import { settingsFormSource } from "../src/workshop/settings-form.source.ts";
import * as settingsStories from "../src/workshop/settings-page.stories.tsx";

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
  return composeStories(settingsStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const nameField = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
const presenceSwitch = () =>
  screen.getByRole<HTMLInputElement>("checkbox", { name: "Live presence" });

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { name: "Organization settings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Organization" })).toBeTruthy();
    expect(nameField().value).toBe("Support assistant team");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Primary use" })).toBeTruthy();
    expect(presenceSwitch().checked).toBe(true);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  },
  Dirty: async () => {
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
    expect(nameField().value).toBe("Support assistant platform");
  },
  Invalid: async () => {
    expect(await screen.findByText("Name is required")).toBeTruthy();
    expect(nameField().getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(nameField());
  },
  Saving: async () => {
    await screen.findByRole("heading", { name: "Organization" });
    const save = document.querySelector<HTMLButtonElement>(
      'button[form="organization-settings-form"]',
    );
    expect(save?.disabled).toBe(true);
    expect(save?.hasAttribute("data-loading")).toBe(true);
    expect(nameField().disabled).toBe(true);
  },
  Saved: async () => {
    expect(await screen.findByText("Organization updated")).toBeTruthy();
    expect(screen.getByText("Your organization settings have been saved")).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  },
  SaveFailed: async () => {
    const banner = await screen.findByRole("alert");
    expect(within(banner).getByText("Failed to update organization")).toBeTruthy();
    expect(within(banner).getByText(/The organization service did not answer\./)).toBeTruthy();
    expect(within(banner).getByRole("link", { name: "Organization settings help" })).toBeTruthy();
    expect(nameField().value).toBe("Support assistant platform");
  },
  ImmediateSwitchSaving: async () => {
    expect(await screen.findByText("Saving…")).toBeTruthy();
    expect(presenceSwitch().disabled).toBe(true);
    expect(presenceSwitch().checked).toBe(true);
  },
  ImmediateSwitchFailed: async () => {
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't save. Try again.");
    expect(presenceSwitch().checked).toBe(true);
    expect(presenceSwitch().disabled).toBe(false);
  },
  ReadOnly: async () => {
    expect(
      await screen.findByText("Only organization admins can change these settings"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "About roles and access" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(screen.getByText("Support assistant team")).toBeTruthy();
    expect(screen.getByText("Monitor & evaluate LLM apps")).toBeTruthy();
    expect(presenceSwitch().disabled).toBe(true);
    expect(screen.getAllByText("Admin only").length).toBeGreaterThan(0);
  },
  LongDescription: async () => {
    expect(
      await screen.findByText(/which of these settings only an admin can change\./),
    ).toBeTruthy();
    expect(nameField().value).toMatch(/^Support assistant platform team for customer experience/);
  },
  Narrow: async () => {
    const frame = await screen.findByTitle("Settings page at 390 pixels");
    expect(frame.getAttribute("src")).toContain("id=patterns-settings-page--default");
    expect(frame.getAttribute("src")).toContain(":");
    expect(getComputedStyle(frame).width).toBe("390px");
  },
};

describe("the Settings page pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every settings story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

describe("given the organization settings", () => {
  describe("when the reader changes the name and saves", () => {
    /** @scenario Saving the name stores it and says so */
    it("stores the name, clears the unsaved mark and shows the notice", async () => {
      const user = userEvent.setup();
      const stored: string[] = [];
      const save: SaveOrganization = ({ name }) => {
        stored.push(name);
        return Promise.resolve();
      };
      renderWithDesignSystem(<SettingsForm save={save} />);
      await user.clear(nameField());
      await user.type(nameField(), "Support assistant platform");
      expect(screen.getByText("Unsaved changes")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Organization updated")).toBeTruthy();
      expect(stored).toEqual(["Support assistant platform"]);
      expect(nameField().value).toBe("Support assistant platform");
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });
  });

  describe("when a save is refused once", () => {
    /** @scenario A refused save keeps what was typed */
    it("keeps the typed name, then saves on the second try", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const save: SaveOrganization = () =>
        refusals-- > 0
          ? Promise.reject(new Error("The organization service did not answer."))
          : Promise.resolve();
      renderWithDesignSystem(<SettingsForm save={save} />);
      await user.clear(nameField());
      await user.type(nameField(), "Support assistant platform");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      const banner = await screen.findByRole("alert");
      expect(within(banner).getByText("Failed to update organization")).toBeTruthy();
      expect(nameField().value).toBe("Support assistant platform");
      expect(screen.queryByText("Organization updated")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Save changes" }));
      expect(await screen.findByText("Organization updated")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("when the reader clears the name and saves", () => {
    /** @scenario A missing name is said under the field */
    it("says what is wrong, focuses the field and stores nothing", async () => {
      const user = userEvent.setup();
      let calls = 0;
      const save: SaveOrganization = () => {
        calls += 1;
        return Promise.resolve();
      };
      renderWithDesignSystem(<SettingsForm save={save} />);
      await user.clear(nameField());
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      expect(await screen.findByText("Name is required")).toBeTruthy();
      expect(document.activeElement).toBe(nameField());
      expect(calls).toBe(0);
    });
  });

  describe("when the reader flips Live presence with an unsaved name", () => {
    /** @scenario Live presence saves without the form */
    it("saves the switch alone and keeps the unsaved name", async () => {
      const user = userEvent.setup();
      const submitted: OrganizationCalls = { form: 0, presence: [] };
      renderWithDesignSystem(
        <SettingsForm
          save={() => {
            submitted.form += 1;
            return Promise.resolve();
          }}
          savePresence={(enabled) => {
            submitted.presence.push(enabled);
            return Promise.resolve();
          }}
        />,
      );
      await user.clear(nameField());
      await user.type(nameField(), "Support assistant platform");
      await user.click(presenceSwitch());

      expect(await screen.findByText("Saved")).toBeTruthy();
      expect(submitted).toEqual({ form: 0, presence: [false] });
      expect(presenceSwitch().checked).toBe(false);
      expect(nameField().value).toBe("Support assistant platform");
      expect(screen.getByText("Unsaved changes")).toBeTruthy();
      expect(screen.queryByText("Organization updated")).toBeNull();
    });
  });

  describe("when a Live presence change is refused", () => {
    /** @scenario A refused switch goes back and says why */
    it("puts the switch back, says why and does not submit the form", async () => {
      const user = userEvent.setup();
      let formCalls = 0;
      const savePresence: SavePresence = () =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("refused")), 20));
      renderWithDesignSystem(
        <SettingsForm
          save={() => {
            formCalls += 1;
            return Promise.resolve();
          }}
          savePresence={savePresence}
        />,
      );
      await user.click(presenceSwitch());

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Couldn't save. Try again.");
      await waitFor(() => expect(presenceSwitch().checked).toBe(true));
      expect(presenceSwitch().disabled).toBe(false);
      expect(formCalls).toBe(0);
    });
  });
});

interface OrganizationCalls {
  form: number;
  presence: boolean[];
}

describe("given someone who cannot change the settings", () => {
  /** @scenario Read-only settings are explained, not disabled */
  it("shows readable values, no Save changes and a banner naming who can", () => {
    renderWithDesignSystem(<SettingsForm start={{ readOnly: true }} />);
    expect(screen.getByText("Only organization admins can change these settings")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.getByText("Support assistant team")).toBeTruthy();
    expect(presenceSwitch().disabled).toBe(true);
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...settingsFormSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(5);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
