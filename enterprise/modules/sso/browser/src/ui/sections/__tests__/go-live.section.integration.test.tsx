/**
 * @vitest-environment jsdom
 * The last step: every precondition at once rather than the first missing
 * one, a control that appears only when they all hold, and what a connection
 * that is already on says instead.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { GoLiveSection } from "../go-live.section.tsx";

function renderSection(
  overrides: {
    canManage?: boolean;
    activated?: boolean;
    domainProved?: boolean;
    testSignInDone?: boolean;
    breakGlassInPlace?: boolean;
    arrivalsDecided?: boolean;
    activating?: boolean;
    settling?: boolean;
    onSetUpProvisioning?: () => void;
  } = {},
) {
  const onActivate = vi.fn();
  const rendered = renderWithSsoHost(
    <GoLiveSection
      canManage={overrides.canManage ?? true}
      activated={overrides.activated ?? false}
      domainProved={overrides.domainProved ?? false}
      testSignInDone={overrides.testSignInDone ?? false}
      breakGlassInPlace={overrides.breakGlassInPlace ?? false}
      arrivalsDecided={overrides.arrivalsDecided ?? false}
      activating={overrides.activating ?? false}
      settling={overrides.settling ?? false}
      onActivate={onActivate}
      onSetUpProvisioning={overrides.onSetUpProvisioning}
    />,
  );

  return { ...rendered, onActivate };
}

/** Everything the aggregate refuses activation without. */
const READY = {
  domainProved: true,
  testSignInDone: true,
  breakGlassInPlace: true,
  arrivalsDecided: true,
};

afterEach(cleanup);

describe("given a connection with nothing done yet", () => {
  /** @scenario "The go-live step shows all three preconditions rather than the first missing one" */
  it("shows every precondition outstanding, each with the thing that would meet it", () => {
    const { container } = renderSection();

    expect(container.textContent).toContain("No domain of yours is proved yet");
    expect(container.textContent).toContain("Nobody has signed in through the connection yet");
    expect(container.textContent).toContain("Nobody can get in without the identity provider");
    expect(container.textContent).toContain("Claim a domain above and publish the record");
    expect(container.textContent).toContain("Use the test sign-in above");
    expect(container.textContent).toContain("Name somebody who can still get in");
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  });

  it("names what is outstanding rather than offering a control that refuses", () => {
    const { container } = renderSection({ domainProved: true, testSignInDone: true });

    expect(container.textContent).toContain(
      "Turning it on needs somebody who can still get in without it and a decision about who it lets in",
    );
  });
});

describe("given a connection whose preconditions all hold", () => {
  /** @scenario "The go-live button is offered only once every precondition is met" */
  it("offers the control, and turns the connection on when it is pressed", () => {
    const { onActivate } = renderSection(READY);
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("still says nothing is outstanding to a reader who may only look", () => {
    const { container } = renderSection({ ...READY, canManage: false });

    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
    expect(container.textContent).toContain("A domain of yours is proved");
  });
});

describe("given a connection that is already on", () => {
  /** @scenario "A connection that is live says sign-in is decided by it" */
  it("says it is on, and what the next errand is", () => {
    const { container } = renderSection({ ...READY, activated: true });

    expect(container.textContent).toContain("This connection is on");
    expect(container.textContent).toContain("create and remove accounts here");
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull();
  });

  it("carries the reader on to provisioning where the screen routes it", () => {
    const onSetUpProvisioning = vi.fn();
    renderSection({ ...READY, activated: true, onSetUpProvisioning });
    fireEvent.click(screen.getByRole("button", { name: "Set up provisioning" }));

    expect(onSetUpProvisioning).toHaveBeenCalledOnce();
  });
});

// The polling half of "An accepted activation refreshes until the connection
// is shown as active" belongs to the screen that reads the setup; this is the
// half the section owns, so it stays unbound until that screen exists.
describe("while an activation is settling", () => {
  it("says the status is catching up, and refuses a second press", () => {
    renderSection({ ...READY, settling: true });

    expect(screen.getByRole("status").textContent).toContain("Activation accepted");
    expect(screen.getByTestId("connection-go-live-activate")).toHaveProperty("disabled", true);
  });
});
