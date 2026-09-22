/**
 * @vitest-environment jsdom
 * Renaming a connection in place. Unbound: the two scenarios it answers are
 * in upstream's sso-connection-lifecycle.feature, which this branch's copy
 * does not carry yet (handoff §10).
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { ConnectionNameRow } from "../connection-name-row.tsx";

function renderRow(overrides: { canManage?: boolean; renaming?: boolean } = {}) {
  const onRename = vi.fn();
  const rendered = renderWithSsoHost(
    <ConnectionNameRow
      name="lw"
      canManage={overrides.canManage ?? true}
      renaming={overrides.renaming ?? false}
      onRename={onRename}
    />,
  );

  return { ...rendered, onRename };
}

const startEditing = () => fireEvent.click(screen.getByTestId("connection-name-edit"));

afterEach(cleanup);

describe("given an administrator on the connection's card", () => {
  it("offers the name for editing in place, and saves the new one", () => {
    const { onRename } = renderRow();

    expect(screen.getByTestId("connection-name").textContent).toBe("lw");

    startEditing();
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "  Acme Okta  " },
    });
    fireEvent.click(screen.getByTestId("connection-name-save"));

    expect(onRename).toHaveBeenCalledWith({ name: "Acme Okta" });
  });

  it("saves on Enter and keeps the old name on Escape", () => {
    const { onRename } = renderRow();
    startEditing();
    const field = screen.getByLabelText("Connection name");
    fireEvent.change(field, { target: { value: "Acme Okta" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByTestId("connection-name").textContent).toBe("lw");

    startEditing();
    fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "Acme Okta" } });
    fireEvent.keyDown(screen.getByLabelText("Connection name"), { key: "Enter" });

    expect(onRename).toHaveBeenCalledWith({ name: "Acme Okta" });
  });

  it("withholds the save rather than sending a blank one", () => {
    const { onRename } = renderRow();
    startEditing();
    fireEvent.change(screen.getByLabelText("Connection name"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("connection-name-save"));

    expect(screen.getByTestId("connection-name-save")).toHaveProperty("disabled", true);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("asks once while the rename is in flight", () => {
    const { onRename } = renderRow({ renaming: true });
    startEditing();
    fireEvent.click(screen.getByTestId("connection-name-save"));

    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("given a reader who may not manage single sign-on", () => {
  it("shows the name and offers no way to change it", () => {
    renderRow({ canManage: false });

    expect(screen.getByTestId("connection-name").textContent).toBe("lw");
    expect(screen.queryByTestId("connection-name-edit")).toBeNull();
  });
});
