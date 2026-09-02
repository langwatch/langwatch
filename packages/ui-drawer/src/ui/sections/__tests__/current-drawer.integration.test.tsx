/**
 * @vitest-environment jsdom
 *
 * The whole address round trip: a URL names a drawer, the host mounts it, the
 * drawer closes itself, and the address is clean again. `platform/app` had no
 * such test — `CurrentDrawer` was only ever exercised through one drawer's bulk
 * selection — and it is the assertion the moved half most needs, because the
 * router underneath it is the one seam that was redesigned rather than moved.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDrawerOpenRewrite,
  clearDrawerStack,
  clearFlowCallbacks,
  installDrawerOpenRewrite,
  useDrawer,
} from "../../../behavior/use-drawer";
import { CurrentDrawer } from "../current-drawer";

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

const drawers = { readable: ReadableDrawer, other: OtherDrawer };

function Opener() {
  const { openDrawer } = useDrawer<typeof drawers>();
  return (
    <>
      <button type="button" onClick={() => openDrawer("readable", { subject: "a trace" })}>
        open readable
      </button>
      <button type="button" onClick={() => openDrawer("other")}>
        open other
      </button>
    </>
  );
}

function CurrentAddress() {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

function mount(at: string): void {
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
  clearDrawerStack();
  clearFlowCallbacks();
  clearDrawerOpenRewrite();
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

  describe("given a host that installed an open rewrite", () => {
    describe("when a screen opens the drawer the rule redirects", () => {
      it("opens the drawer the rule names instead", async () => {
        installDrawerOpenRewrite((drawer, props) =>
          drawer === "readable" ? { drawer: "other", props } : { drawer, props },
        );
        mount("/acme/traces");
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: "open readable" }));

        expect(await screen.findByText("the other drawer")).toBeInTheDocument();
      });
    });
  });
});
