/**
 * @vitest-environment jsdom
 * The whole address round trip: a URL names a drawer, the host mounts it,
 * the drawer closes itself, and the address is clean again. The router
 * underneath is the one seam that was redesigned rather than moved.
 */

import { uiTokens } from "@langwatch/module";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Location, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { clearFlowCallbacks, useDrawer } from "../../../behavior/use-drawer.ts";
import { CurrentDrawer } from "../current-drawer.tsx";

function ReadableDrawer({ subject }: { subject?: string }) {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  return (
    <div>
      <p>reading {subject ?? "nothing"}</p>
      <button type="button" onClick={closeDrawer}>
        close
      </button>
      {canGoBack && (
        <button type="button" onClick={goBack}>
          back
        </button>
      )}
    </div>
  );
}

function OtherDrawer() {
  const { canGoBack, goBack } = useDrawer();
  return (
    <div>
      <p>the other drawer</p>
      {canGoBack && (
        <button type="button" onClick={goBack}>
          back
        </button>
      )}
    </div>
  );
}

/** Reads `open` the strict way, as the prompt editor did when every address opened nothing. */
function StrictDrawer({ open }: { open?: boolean }) {
  return open === true ? <p>the strict drawer is open</p> : null;
}

const drawers = { readable: ReadableDrawer, other: OtherDrawer, strict: StrictDrawer };

const ReadableToken = uiTokens("trace").drawer<{ subject?: string }>("readable");
const OtherToken = uiTokens("trace").drawer<object>("other");

function Opener() {
  const { openDrawer } = useDrawer();
  return (
    <>
      <button type="button" onClick={() => openDrawer(ReadableToken, { subject: "a trace" })}>
        open readable
      </button>
      <button type="button" onClick={() => openDrawer(OtherToken)}>
        open other
      </button>
    </>
  );
}

let lastLocation: Location | undefined;

function CurrentAddress() {
  const location = useLocation();
  const navigate = useNavigate();
  lastLocation = location;
  return (
    <>
      <output data-testid="address">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        browser back
      </button>
    </>
  );
}

/** A reload keeps the address and `history.state`, so it comes back as the same entry. */
function reload(): void {
  const entry = {
    pathname: lastLocation?.pathname,
    search: lastLocation?.search,
    state: lastLocation?.state,
  };
  cleanup();
  mount(entry);
}

function mount(at: string | { pathname?: string; search?: string; state?: unknown }): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route
          path="/:project/traces"
          element={
            <>
              <Opener />
              <CurrentAddress />
              <CurrentDrawer drawers={drawers} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const address = () => screen.getByTestId("address").textContent;

beforeEach(() => {
  lastLocation = undefined;
  clearFlowCallbacks();
});

describe("the drawer host", () => {
  describe("given an address that names a drawer", () => {
    describe("when the page renders", () => {
      it("mounts that drawer with the parameters the address carries", async () => {
        mount("/acme/traces?drawer.open=readable&drawer.subject=a%20trace");

        expect(await screen.findByText("reading a trace")).toBeInTheDocument();
      });
    });

    describe("when the reader closes it", () => {
      it("takes the drawer out of the address and off the screen", async () => {
        mount("/acme/traces?view=table&drawer.open=readable&drawer.subject=a%20trace");
        const user = userEvent.setup();

        await user.click(await screen.findByRole("button", { name: "close" }));

        await waitFor(() => expect(address()).toBe("/acme/traces?view=table"));
        expect(screen.queryByText("reading a trace")).not.toBeInTheDocument();
      });
    });
  });

  describe("given an address that names a drawer checking its open prop", () => {
    describe("when the page renders", () => {
      /** @scenario "A drawer the host mounts from an address reads itself as open" */
      it("hands the drawer open as true rather than the drawer's name", async () => {
        mount("/acme/traces?drawer.open=strict");

        expect(await screen.findByText("the strict drawer is open")).toBeInTheDocument();
      });
    });
  });

  describe("given an address that names no drawer", () => {
    describe("when the page renders", () => {
      it("mounts nothing", () => {
        mount("/acme/traces");

        expect(screen.queryByText(/^reading /)).not.toBeInTheDocument();
      });
    });

    describe("when a screen opens one", () => {
      it("writes the name and the serialisable props into the address", async () => {
        mount("/acme/traces");
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: "open readable" }));

        await waitFor(() =>
          expect(address()).toBe("/acme/traces?drawer.open=readable&drawer.subject=a%20trace"),
        );
        expect(await screen.findByText("reading a trace")).toBeInTheDocument();
      });
    });
  });

  describe("given an address that names a drawer nothing installed", () => {
    describe("when the page renders", () => {
      it("mounts nothing rather than throwing", () => {
        mount("/acme/traces?drawer.open=neverInstalled");

        expect(screen.queryByText(/^reading /)).not.toBeInTheDocument();
      });
    });
  });

  describe("given a reader who walked from one drawer into another", () => {
    describe("when they go back", () => {
      /** @scenario "Going back from a sub-flow returns to the drawer that opened it" */
      it("returns to the first drawer with its parameters restored", async () => {
        mount("/acme/traces");
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: "open readable" }));
        await screen.findByText("reading a trace");
        await user.click(screen.getByRole("button", { name: "open other" }));
        await screen.findByText("the other drawer");

        await user.click(await screen.findByRole("button", { name: "back" }));

        expect(await screen.findByText("reading a trace")).toBeInTheDocument();
      });
    });
  });

  describe("given a reader who opened a drawer from a page", () => {
    describe("when they press the browser's back button", () => {
      /** @scenario "Back closes the drawer that was opened last" */
      it("takes the drawer off the screen and out of the address", async () => {
        mount("/acme/traces");
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open readable" }));
        await screen.findByText("reading a trace");

        await user.click(screen.getByRole("button", { name: "browser back" }));

        await waitFor(() => expect(address()).toBe("/acme/traces"));
        expect(screen.queryByText("reading a trace")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a reader who walked from one drawer into another", () => {
    describe("when they press the browser's back button", () => {
      /** @scenario "Back closes a stacked drawer and returns to the one beneath" */
      it("closes the top drawer and shows the one beneath with its parameters", async () => {
        mount("/acme/traces");
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open readable" }));
        await screen.findByText("reading a trace");
        await user.click(screen.getByRole("button", { name: "open other" }));
        await screen.findByText("the other drawer");

        await user.click(screen.getByRole("button", { name: "browser back" }));

        expect(await screen.findByText("reading a trace")).toBeInTheDocument();
        expect(screen.queryByText("the other drawer")).not.toBeInTheDocument();
      });
    });

    describe("when the page is reloaded", () => {
      /** @scenario "A reload restores the open drawer and the stack beneath it" */
      it("shows the same drawer, and going back still reaches the one beneath", async () => {
        mount("/acme/traces");
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open readable" }));
        await screen.findByText("reading a trace");
        await user.click(screen.getByRole("button", { name: "open other" }));
        await screen.findByText("the other drawer");

        reload();

        expect(await screen.findByText("the other drawer")).toBeInTheDocument();
        await user.click(await screen.findByRole("button", { name: "back" }));
        expect(await screen.findByText("reading a trace")).toBeInTheDocument();
      });
    });

    describe("when they close the drawer", () => {
      /** @scenario "Closing a drawer clears the stack beneath it" */
      it("leaves nothing to go back to after a reload", async () => {
        mount("/acme/traces?drawer.open=readable");
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "open other" }));
        await screen.findByText("the other drawer");
        await user.click(screen.getByRole("button", { name: "open readable" }));
        await screen.findByText("reading a trace");
        await user.click(await screen.findByRole("button", { name: "close" }));
        await waitFor(() => expect(address()).toBe("/acme/traces"));

        expect(lastLocation?.state).toBeNull();
        reload();

        expect(screen.queryByRole("button", { name: "back" })).not.toBeInTheDocument();
      });
    });
  });

  describe("given a drawer opened from a pasted link", () => {
    describe("when the reader looks for a way back", () => {
      it("offers none, because nothing was opened beneath it", async () => {
        mount("/acme/traces?drawer.open=readable&drawer.subject=a%20trace");

        await screen.findByText("reading a trace");

        expect(screen.queryByRole("button", { name: "back" })).not.toBeInTheDocument();
      });
    });
  });
});
