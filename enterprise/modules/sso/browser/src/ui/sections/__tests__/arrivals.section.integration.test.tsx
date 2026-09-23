/**
 * @vitest-environment jsdom
 * Who a connection admits: the answer going live waits for, asked only once
 * a domain is proved, and saved in the connection's own vocabulary.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { ArrivalsSection } from "../arrivals.section.tsx";

function renderSection(
  overrides: {
    connectionState?: Parameters<typeof ArrivalsSection>[0]["connectionState"];
    policy?: Parameters<typeof ArrivalsSection>[0]["policy"];
    decided?: boolean;
    canManage?: boolean;
    saving?: boolean;
  } = {},
) {
  const onSave = vi.fn();
  const rendered = renderWithSsoHost(
    <ArrivalsSection
      connectionState={overrides.connectionState ?? "VERIFIED"}
      canManage={overrides.canManage ?? true}
      policy={overrides.policy ?? "refuse"}
      decided={overrides.decided ?? false}
      saving={overrides.saving ?? false}
      onSave={onSave}
    />,
  );

  return { ...rendered, onSave };
}

/** The hidden input is what the answer is named by, and the radio group
 *  only hears a press that carries the pointer events a reader's would. */
const choose = async (policy: string) => {
  await userEvent.click(screen.getByTestId(`arrivals-${policy}`));
};

afterEach(cleanup);

describe("given a connection with no proved domain", () => {
  it("says what has to happen first, and offers nothing to answer with", () => {
    renderSection({ connectionState: "DRAFT" });

    expect(screen.getByRole("status").textContent).toContain("Verify a domain");
    expect(screen.getByTestId("arrivals-admit")).toHaveProperty("disabled", true);
  });
});

describe("given a connection whose domain is proved", () => {
  it("recommends one answer out loud rather than by its position", () => {
    renderSection();

    expect(screen.getByTestId("arrivals-recommended")).toBeTruthy();
    expect(screen.getByText("They join, on a domain you verified")).toBeTruthy();
  });

  it("saves the answer in the connection's own word", async () => {
    const { onSave } = renderSection();
    await choose("admit");
    fireEvent.click(screen.getByRole("button", { name: "Confirm choice" }));

    expect(onSave).toHaveBeenCalledWith("admit");
  });

  it("says what still bounds the widest answer, where it is chosen", async () => {
    renderSection();
    await choose("admit");

    expect(screen.getByText(/only addresses that reach this connection/)).toBeTruthy();
  });

  it("asks for a first answer even where nothing was changed", () => {
    renderSection({ policy: "refuse", decided: false });

    expect(screen.getByRole("button", { name: "Confirm choice" })).toBeTruthy();
  });
});

describe("given an answer somebody already gave", () => {
  it("offers nothing to press while it stands", () => {
    renderSection({ policy: "admit", decided: true });

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm choice" })).toBeNull();
  });

  it("offers to save a change, and to put it back", async () => {
    const { onSave } = renderSection({ policy: "admit", decided: true });
    await choose("refuse");

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("given a reader who may not manage single sign-on", () => {
  it("shows the answer and lets nobody change it", () => {
    renderSection({ canManage: false, policy: "request", decided: true });

    expect(screen.getByTestId("arrivals-request")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
