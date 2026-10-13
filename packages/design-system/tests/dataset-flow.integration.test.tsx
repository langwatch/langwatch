import { toaster } from "@langwatch/design-system/toaster";
/** @vitest-environment jsdom */
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import previewAnnotations from "../.storybook/preview.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";
import {
  DatasetFlow,
  SEED_DATASETS,
  type SaveDataset,
} from "../src/workshop/dataset-flow.example.tsx";
import { datasetFlowSource } from "../src/workshop/dataset-flow.source.ts";
import * as datasetStories from "../src/workshop/dataset-flow.stories.tsx";

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
  return composeStories(datasetStories, {
    ...previewAnnotations,
    initialGlobals: { ...previewAnnotations.initialGlobals, colorMode: mode },
  });
}

const visibleStates = {
  Default: async () => {
    expect(await screen.findByRole("heading", { name: "Datasets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refund questions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delivery questions" })).toBeTruthy();
  },
  CreateOpen: async () => {
    const drawer = await screen.findByRole("dialog", { name: "New dataset" });
    expect(within(drawer).getByRole("textbox", { name: "Name" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Create dataset" })).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    const ids = [...drawer.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  },
  EditOpen: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Edit dataset" });
    const name = within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" });
    expect(name.value).toBe("Refund questions");
    expect(within(drawer).getByRole("button", { name: "Save changes" })).toBeTruthy();
  },
  InvalidName: async () => {
    const drawer = await screen.findByRole("dialog", { name: "New dataset" });
    expect(within(drawer).getByText("Name is required")).toBeTruthy();
    expect(within(drawer).getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
  },
  DuplicateColumn: async () => {
    const drawer = await screen.findByRole("dialog", { name: "New dataset" });
    expect(within(drawer).getByText(/Column names must be unique/)).toBeTruthy();
    expect(within(drawer).getAllByRole("textbox", { name: /Column \d name/ })).toHaveLength(2);
  },
  Saving: async () => {
    const drawer = await screen.findByRole("dialog", { name: "Edit dataset" });
    const save = within(drawer).getByRole<HTMLButtonElement>("button", { name: "Save changes" });
    expect(save.disabled).toBe(true);
    expect(save.hasAttribute("data-loading")).toBe(true);
    expect(save.getAttribute("aria-busy")).toBe("true");
    expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).disabled).toBe(
      true,
    );
  },
  SaveFailed: async () => {
    const drawer = await screen.findByRole("dialog", { name: "New dataset" });
    const alert = within(drawer).getByRole("alert");
    expect(within(alert).getByText("Couldn't save the dataset")).toBeTruthy();
    expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
      "Billing questions",
    );
  },
  DeleteConfirm: async () => {
    const dialog = await screen.findByRole("alertdialog", { name: "Delete dataset?" });
    expect(within(dialog).getByText(/"Refund questions" and its 42 entries/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Delete dataset" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
  },
  DeletedWithUndo: async () => {
    expect(await screen.findByText("Dataset Refund questions deleted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Refund questions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delivery questions" })).toBeTruthy();
  },
  Empty: async () => {
    expect(await screen.findByText("No datasets yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Read about datasets" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  },
  NoResults: async () => {
    expect(await screen.findByText('No dataset is called "Billing questions".')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
    ).toBeTruthy();
  },
  Loading: async () => {
    expect(await screen.findByLabelText("Loading records")).toBeTruthy();
    expect(
      screen.getByRole<HTMLInputElement>("searchbox", { name: "Search datasets" }).disabled,
    ).toBe(true);
  },
  Narrow: async () => {
    expect(await screen.findByRole("heading", { name: "Datasets" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Datasets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New dataset" })).toBeTruthy();
  },
};

describe("the Create, edit and delete pattern", () => {
  describe.each(["light", "dark"] as const)("given the %s colour mode", (mode) => {
    const stories = composedFor(mode);

    it("has a test for every named story", () => {
      expect(Object.keys(stories).toSorted()).toEqual(Object.keys(visibleStates).toSorted());
    });

    describe.each(Object.entries(visibleStates))("when %s is rendered", (name, expectState) => {
      /** @scenario Every dataset story shows its state in light and dark */
      it("shows its own state", async () => {
        const Story = stories[name as keyof typeof stories];
        render(<Story />);
        expect(document.documentElement.classList.contains(mode)).toBe(true);
        await expectState();
      });
    });
  });
});

async function createDataset({
  user,
  name,
}: {
  user: ReturnType<typeof userEvent.setup>;
  name: string;
}) {
  await user.click(screen.getByRole("button", { name: "New dataset" }));
  const drawer = await screen.findByRole("dialog", { name: "New dataset" });
  await user.type(within(drawer).getByRole("textbox", { name: "Name" }), name);
  await user.click(within(drawer).getByRole("button", { name: "Create dataset" }));
}

async function chooseRowAction({
  user,
  dataset,
  action,
}: {
  user: ReturnType<typeof userEvent.setup>;
  dataset: string;
  action: "Edit" | "Delete";
}) {
  await user.click(screen.getByRole("button", { name: `Actions for ${dataset}` }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

function rowOf(name: string) {
  return screen.getByRole("button", { name }).closest("tr");
}

describe("given the dataset list", () => {
  describe("when a row has its actions menu", () => {
    /** @scenario The row menu trigger draws a decorative ellipsis icon */
    it("draws the trigger glyph as a decorative icon and names the trigger by its row", () => {
      renderWithDesignSystem(<DatasetFlow />);
      const trigger = screen.getByRole("button", { name: "Actions for Refund questions" });

      expect(trigger.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(trigger.textContent).toBe("");
    });
  });

  describe("when the reader creates, renames and deletes a dataset", () => {
    /** @scenario A new dataset joins the list */
    it("adds a row for the new name and closes the form", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await createDataset({ user, name: "Refund escalations" });

      expect(await screen.findByRole("button", { name: "Refund escalations" })).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New dataset" })).toBeNull());
    });

    /** @scenario Renaming changes the same row */
    it("keeps the same row when the name changes", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await createDataset({ user, name: "Refund escalations" });
      const before = (await screen.findByRole("button", { name: "Refund escalations" })).closest(
        "tr",
      )?.dataset.datasetId;

      await chooseRowAction({ user, dataset: "Refund escalations", action: "Edit" });
      const drawer = await screen.findByRole("dialog", { name: "Edit dataset" });
      const name = within(drawer).getByRole("textbox", { name: "Name" });
      await user.clear(name);
      await user.type(name, "Escalated refunds");
      await user.click(within(drawer).getByRole("button", { name: "Save changes" }));

      const renamed = await screen.findByRole("button", { name: "Escalated refunds" });
      expect(renamed.closest("tr")?.dataset.datasetId).toBe(before);
      expect(screen.queryByRole("button", { name: "Refund escalations" })).toBeNull();
    });

    /** @scenario Cancelling a delete keeps the dataset */
    it("keeps the dataset when the confirmation is cancelled", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await chooseRowAction({ user, dataset: "Delivery questions", action: "Delete" });
      const dialog = await screen.findByRole("alertdialog", { name: "Delete dataset?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      const row = screen.getByRole("button", { name: "Delivery questions" });
      await waitFor(() => expect(document.activeElement).toBe(row));
    });

    /** @scenario Confirming a delete removes the row and moves focus */
    it("removes the row, names it in a notice and focuses the neighbour", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await chooseRowAction({ user, dataset: "Delivery questions", action: "Delete" });
      const dialog = await screen.findByRole("alertdialog", { name: "Delete dataset?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete dataset" }));

      expect(await screen.findByText("Dataset Delivery questions deleted")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delivery questions" })).toBeNull();
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Refund questions" }),
        ),
      );
    });

    /** @scenario Closing a confirmation hands focus to the element the caller names */
    it("focuses New dataset when the last row is deleted", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow start={{ datasets: SEED_DATASETS.slice(0, 1) }} />);
      await chooseRowAction({ user, dataset: "Refund questions", action: "Delete" });
      const dialog = await screen.findByRole("alertdialog", { name: "Delete dataset?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete dataset" }));

      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "New dataset" })),
      );
    });

    /** @scenario Undo puts the dataset back where it was */
    it("restores the dataset to its place when Undo is chosen", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await chooseRowAction({ user, dataset: "Refund questions", action: "Delete" });
      const dialog = await screen.findByRole("alertdialog", { name: "Delete dataset?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete dataset" }));
      expect(screen.queryByRole("button", { name: "Refund questions" })).toBeNull();

      await user.click(await screen.findByRole("button", { name: "Undo" }));

      await waitFor(() => expect(rowOf("Refund questions")).not.toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Refund questions" }),
        ),
      );
      const names = screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("button")[0]?.textContent);
      expect(names).toEqual(["Refund questions", "Delivery questions"]);
    });
  });

  describe("when the reader submits the form without a name", () => {
    /** @scenario An invalid name is said under the field */
    it("explains the problem, focuses the field and adds nothing", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await user.click(screen.getByRole("button", { name: "New dataset" }));
      const drawer = await screen.findByRole("dialog", { name: "New dataset" });
      await user.click(within(drawer).getByRole("button", { name: "Create dataset" }));

      expect(await within(drawer).findByText("Name is required")).toBeTruthy();
      expect(document.activeElement).toBe(within(drawer).getByRole("textbox", { name: "Name" }));
      expect(screen.getAllByRole("row")).toHaveLength(3);
    });
  });

  describe("when a save is refused once", () => {
    /** @scenario A refused save keeps the draft and can be retried */
    it("keeps the name and columns, then saves on the second try", async () => {
      const user = userEvent.setup();
      let refusals = 1;
      const save: SaveDataset = () => {
        if (refusals-- > 0) return Promise.reject(new Error("The dataset service did not answer."));
        return Promise.resolve();
      };
      renderWithDesignSystem(<DatasetFlow save={save} />);
      await createDataset({ user, name: "Billing questions" });

      const drawer = await screen.findByRole("dialog", { name: "New dataset" });
      expect(await within(drawer).findByText("Couldn't save the dataset")).toBeTruthy();
      expect(within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(
        "Billing questions",
      );
      expect(
        within(drawer).getByRole<HTMLInputElement>("textbox", { name: "Column 2 name" }).value,
      ).toBe("expected_answer");

      await user.click(within(drawer).getByRole("button", { name: "Create dataset" }));
      expect(await screen.findByRole("button", { name: "Billing questions" })).toBeTruthy();
    });
  });

  describe("when a search matches nothing", () => {
    /** @scenario A search with no match offers a way out */
    it("says so, offers Clear filters and an agent prompt, and Clear restores the list", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetFlow />);
      await user.type(screen.getByRole("searchbox", { name: "Search datasets" }), "Billing");

      expect(await screen.findByText('No dataset is called "Billing".')).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Copy a prompt for your coding agent" }),
      ).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(await screen.findByRole("button", { name: "Refund questions" })).toBeTruthy();
    });
  });
});

describe("given the source of the example", () => {
  /** @scenario The example uses only public design system entry points */
  it("imports no Chakra, Emotion or design system file by relative path", () => {
    const specifiers = [...datasetFlowSource.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(specifiers.length).toBeGreaterThan(5);
    for (const specifier of specifiers) {
      const allowed =
        specifier === "react" || specifier?.startsWith("@langwatch/design-system/") === true;
      expect(allowed, `${specifier} is not a public entry point`).toBe(true);
    }
  });
});
