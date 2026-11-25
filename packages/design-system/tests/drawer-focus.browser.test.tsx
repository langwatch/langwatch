/// <reference types="@vitest/browser-playwright" />
/**
 * Where focus lands when a non-modal drawer closes, in real Chromium: the opener or an explicit
 * target, never a page the reader has moved on to, once, after the exit has settled.
 * @see packages/design-system/specs/overlay-shapes.feature
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";

import { Dialog } from "../src/components/overlays/dialog.tsx";
import { Drawer } from "../src/components/overlays/drawer.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

beforeEach(async () => {
  await page.viewport(1000, 700);
});

afterEach(async () => {
  cleanup();
  document.body.replaceChildren();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

const NAME = "Edit key";

interface HarnessProps {
  finalFocusEl?: () => HTMLElement | null;
  /** Render the drawer only while it is open, as a routed host does. */
  mountOnlyWhileOpen?: boolean;
  startOpen?: boolean;
}

function Harness({ finalFocusEl, mountOnlyWhileOpen = false, startOpen = false }: HarnessProps) {
  const [open, setOpen] = useState(startOpen);
  const close = () => setOpen(false);
  const drawer = (
    <Drawer
      open={open}
      onClose={close}
      title={NAME}
      finalFocusEl={finalFocusEl}
      footer={{
        primaryAction: { label: "Save", onClick: close },
        cancel: { label: "Cancel", onClick: close },
      }}
    >
      <input aria-label="Name" />
    </Drawer>
  );
  return (
    <>
      <div style={{ height: 1400 }} />
      <button type="button" onClick={() => setOpen(true)}>
        Open edit
      </button>
      <button type="button" onClick={close}>
        Close from the page
      </button>
      <input aria-label="Page field" />
      {mountOnlyWhileOpen ? open && drawer : drawer}
    </>
  );
}

const opener = () => screen.getByRole("button", { name: "Open edit" });
const drawerIsGone = () =>
  waitFor(() => expect(screen.queryByRole("dialog", { name: NAME })).toBeNull());

async function openDrawer() {
  const trigger = opener();
  trigger.scrollIntoView({ block: "center" });
  await userEvent.click(trigger);
  const drawer = await screen.findByRole("dialog", { name: NAME });
  await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
  return { trigger, drawer };
}

describe("a non-modal drawer closing in a browser", () => {
  const closers: [string, () => Promise<void>][] = [
    ["Escape", () => userEvent.keyboard("{Escape}")],
    [
      "the X",
      () =>
        userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" })),
    ],
    [
      "Cancel",
      () =>
        userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })),
    ],
    [
      "a footer action",
      () =>
        userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" })),
    ],
  ];

  for (const [name, close] of closers) {
    /** @scenario "A non-modal drawer returns focus to the control that opened it" */
    it(`returns focus to the opener when it closes by ${name}, once and without scrolling`, async () => {
      renderWithDesignSystem(<Harness />);
      const { trigger } = await openDrawer();
      const scrolled = window.scrollY;
      const focus = vi.spyOn(trigger, "focus");

      await close();
      await drawerIsGone();

      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(focus).toHaveBeenCalledTimes(1);
      expect(window.scrollY).toBe(scrolled);
    });
  }

  /** @scenario "A non-modal drawer returns focus to the control that opened it" */
  it("returns focus when its owner unmounts it instead of closing it", async () => {
    renderWithDesignSystem(<Harness mountOnlyWhileOpen />);
    const { trigger } = await openDrawer();

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await drawerIsGone();

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  /** @scenario "A drawer mounted open, or rendered twice by StrictMode, restores only after a real close" */
  it("restores nothing while it is open or never opened under StrictMode, then exactly once", async () => {
    const earlier = document.createElement("button");
    earlier.textContent = "Earlier";
    document.body.append(earlier);
    earlier.focus();
    const focus = vi.spyOn(earlier, "focus");

    const closed = renderWithDesignSystem(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(document.activeElement).toBe(earlier);
    expect(focus).not.toHaveBeenCalled();
    closed.unmount();

    renderWithDesignSystem(
      <StrictMode>
        <Harness startOpen mountOnlyWhileOpen />
      </StrictMode>,
    );
    const drawer = await screen.findByRole("dialog", { name: NAME });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    expect(focus).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    await drawerIsGone();

    await waitFor(() => expect(document.activeElement).toBe(earlier));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A drawer that exits under reduced motion still returns focus" */
  it("returns focus when the reader has asked for reduced motion", async () => {
    await cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    renderWithDesignSystem(<Harness />);
    const { trigger } = await openDrawer();

    await userEvent.keyboard("{Escape}");
    await drawerIsGone();

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("a drawer given somewhere else to return", () => {
  /** @scenario "A drawer returns focus to an explicit target and skips one that cannot take it" */
  it("asks the resolver when it closes, and falls back to the opener when it answers nothing", async () => {
    let answer: HTMLElement | null = null;
    renderWithDesignSystem(<Harness finalFocusEl={() => answer} />);
    const { trigger } = await openDrawer();
    answer = screen.getByRole("textbox", { name: "Page field" });

    await userEvent.keyboard("{Escape}");
    await drawerIsGone();
    await waitFor(() => expect(document.activeElement).toBe(answer));

    await openDrawer();
    answer = null;
    await userEvent.keyboard("{Escape}");
    await drawerIsGone();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  /** @scenario "A drawer returns focus to an explicit target and skips one that cannot take it" */
  it("takes no focus into a disabled, hidden or removed target and throws nothing", async () => {
    let target: HTMLElement | null = null;
    renderWithDesignSystem(<Harness finalFocusEl={() => target} />);

    for (const break_ of [
      (element: HTMLElement) => element.setAttribute("disabled", ""),
      (element: HTMLElement) => element.setAttribute("hidden", ""),
      (element: HTMLElement) => element.setAttribute("inert", ""),
    ]) {
      const { trigger } = await openDrawer();
      target = trigger;
      break_(trigger);
      await userEvent.keyboard("{Escape}");
      await drawerIsGone();
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      expect(document.activeElement).toBe(document.body);
      trigger.removeAttribute("disabled");
      trigger.removeAttribute("hidden");
      trigger.removeAttribute("inert");
    }
  });

  /** @scenario "A drawer returns focus to an explicit target and skips one that cannot take it" */
  it("lets the owning screen name the next row when the opener's row was deleted", async () => {
    const rows = new Map<string, HTMLElement>();
    function Rows() {
      const [names, setNames] = useState(["alpha", "beta", "gamma"]);
      const [open, setOpen] = useState<string>();
      return (
        <>
          {names.map((name) => (
            <button
              key={name}
              type="button"
              ref={(element) => {
                if (element) rows.set(name, element);
                else rows.delete(name);
              }}
              onClick={() => setOpen(name)}
            >
              Open {name}
            </button>
          ))}
          <Drawer
            open={open !== undefined}
            onClose={() => setOpen(undefined)}
            title={NAME}
            finalFocusEl={() => rows.get("gamma") ?? null}
            footer={{
              destructiveAction: {
                label: "Delete",
                onClick: () => {
                  setNames((current) => current.filter((name) => name !== open));
                  setOpen(undefined);
                },
              },
            }}
          >
            <input aria-label="Name" />
          </Drawer>
        </>
      );
    }
    renderWithDesignSystem(<Rows />);

    await userEvent.click(screen.getByRole("button", { name: "Open beta" }));
    const drawer = await screen.findByRole("dialog", { name: NAME });
    await userEvent.click(within(drawer).getByRole("button", { name: "Delete" }));
    await drawerIsGone();

    expect(screen.queryByRole("button", { name: "Open beta" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rows.get("gamma")));
  });
});

describe("a drawer and focus that has moved on", () => {
  /** @scenario "A drawer does not take back focus that moved on by choice" */
  it("leaves focus on a page control the reader chose before it closed", async () => {
    renderWithDesignSystem(<Harness />);
    await openDrawer();

    const away = screen.getByRole("button", { name: "Close from the page" });
    await userEvent.click(away);
    await drawerIsGone();

    expect(document.activeElement).toBe(away);
  });

  /** @scenario "A drawer does not take back focus that moved on by choice" */
  it("yields to a dialog that opens in the interaction that closes it", async () => {
    function Review() {
      const [drawer, setDrawer] = useState(false);
      const [dialog, setDialog] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDrawer(true)}>
            Open edit
          </button>
          <Drawer
            open={drawer}
            onClose={() => setDrawer(false)}
            title={NAME}
            footer={{
              primaryAction: {
                label: "Save and review",
                onClick: () => {
                  setDrawer(false);
                  setDialog(true);
                },
              },
            }}
          >
            <input aria-label="Name" />
          </Drawer>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Review the change"
            primaryAction={{ label: "Looks right", onClick: () => setDialog(false) }}
          />
        </>
      );
    }
    renderWithDesignSystem(<Review />);
    await userEvent.click(opener());
    const drawer = await screen.findByRole("dialog", { name: NAME });
    await userEvent.click(within(drawer).getByRole("button", { name: "Save and review" }));

    const review = await screen.findByRole("dialog", { name: "Review the change" });
    await waitFor(() => expect(review.contains(document.activeElement)).toBe(true));
    await drawerIsGone();
    expect(review.contains(document.activeElement)).toBe(true);
  });

  /** @scenario "A drawer does not take back focus that moved on by choice" */
  it("stays open with focus inside when it is reopened while it is still leaving", async () => {
    renderWithDesignSystem(<Harness />);
    const { trigger } = await openDrawer();

    await userEvent.keyboard("{Escape}");
    await userEvent.click(trigger);

    const drawer = await screen.findByRole("dialog", { name: NAME });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(drawer.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");
    await drawerIsGone();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("a drawer over a dialog, and a drawer built from parts", () => {
  /** @scenario "A drawer opened over a dialog leaves restoration to the dialog's trap" */
  it("is modal over a dialog and returns focus to the dialog's control", async () => {
    function Over() {
      const [dialog, setDialog] = useState(true);
      const [drawer, setDrawer] = useState(false);
      return (
        <>
          <Dialog open={dialog} onClose={() => setDialog(false)} title="Keys">
            <button type="button" onClick={() => setDrawer(true)}>
              Edit from the dialog
            </button>
          </Dialog>
          <Drawer open={drawer} onClose={() => setDrawer(false)} title={NAME}>
            <input aria-label="Name" />
          </Drawer>
        </>
      );
    }
    renderWithDesignSystem(<Over />);
    const control = await screen.findByRole("button", { name: "Edit from the dialog" });
    await userEvent.click(control);
    const drawer = await screen.findByRole("dialog", { name: NAME });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

    await userEvent.keyboard("{Escape}");
    await drawerIsGone();

    await waitFor(() => expect(document.activeElement).toBe(control));
  });

  /** @scenario "A drawer opened over a dialog leaves restoration to the dialog's trap" */
  it("returns focus to the trigger of a drawer built from parts", async () => {
    renderWithDesignSystem(
      <Drawer.Root>
        <Drawer.Trigger asChild>
          <button type="button">Open parts</button>
        </Drawer.Trigger>
        <Drawer.Content aria-label="Parts">
          <Drawer.Body>
            <input aria-label="Name" />
          </Drawer.Body>
          <Drawer.CloseTrigger />
        </Drawer.Content>
      </Drawer.Root>,
    );
    const trigger = screen.getByRole("button", { name: "Open parts" });

    await userEvent.click(trigger);
    const drawer = await screen.findByRole("dialog", { name: "Parts" });
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Parts" })).toBeNull());

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("the drawer's close button on open", () => {
  const closeButton = () =>
    within(screen.getByRole("dialog", { name: NAME })).getByRole("button", { name: "Close" });

  /** @scenario "A drawer opened by a click shows no focus ring on its close button" */
  it("draws no ring when the drawer was opened with the pointer", async () => {
    renderWithDesignSystem(<Harness />);
    await openDrawer();
    if (document.activeElement !== closeButton()) closeButton().focus();

    await waitFor(() => expect(closeButton().getAttribute("data-pointer-focus")).not.toBeNull());
    expect(getComputedStyle(closeButton()).outlineStyle).toBe("none");
  });

  /** @scenario "A drawer opened by a click shows no focus ring on its close button" */
  it("keeps the ring when the close button is reached with the keyboard", async () => {
    renderWithDesignSystem(<Harness />);
    await openDrawer();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Tab}");
    closeButton().focus();

    await waitFor(() => expect(closeButton().getAttribute("data-pointer-focus")).toBeNull());
  });
});

/** Collects uncaught errors and console errors raised while the callback runs and settles. */
async function collectErrors(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onError = (event: ErrorEvent) => {
    seen.push(String(event.error?.message ?? event.message));
    event.preventDefault();
  };
  const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    seen.push(args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(" "));
  });
  window.addEventListener("error", onError);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    window.removeEventListener("error", onError);
    consoleError.mockRestore();
  }
  return seen;
}

describe("a routed drawer unmounted over a dialog that re-renders in the same commit", () => {
  /** The page holds the dialog; a host later in the tree mounts the drawer only while routed. */
  function RoutedOverDialog() {
    const [routed, setRouted] = useState(false);
    const [picks, setPicks] = useState(0);
    return (
      <>
        <section>
          <Dialog open onClose={() => undefined} title="Run" cancelLabel={null}>
            <p>Picked {picks}</p>
            <button type="button" onClick={() => setRouted(true)}>
              Add evaluator
            </button>
          </Dialog>
        </section>
        <aside>
          {routed && (
            <Drawer open onClose={() => setRouted(false)} title={NAME}>
              <button
                type="button"
                onClick={() => {
                  setPicks((count) => count + 1);
                  setRouted(false);
                }}
              >
                Pick
              </button>
            </Drawer>
          )}
        </aside>
      </>
    );
  }

  /** @scenario "A routed drawer closing over a dialog that re-renders hands focus back without an error" */
  it("raises no initialFocus error and focus returns inside the dialog", async () => {
    renderWithDesignSystem(<RoutedOverDialog />);
    const dialog = await screen.findByRole("dialog", { name: "Run" });

    const errors = await collectErrors(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Add evaluator" }));
      const drawer = await screen.findByRole("dialog", { name: NAME });
      await userEvent.click(within(drawer).getByRole("button", { name: "Pick" }));
      await drawerIsGone();
    });

    expect(errors.filter((message) => /initialFocus|focus-trap/.test(message))).toEqual([]);
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });
});
