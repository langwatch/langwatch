/**
 * @vitest-environment jsdom
 * The tiles the setup journey opens with. Unbound: the picker's own scenarios
 * arrive with `RegisterConnection`, which waits on `ssoSetup.register`
 * (handoff §10).
 */

import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { identityProviderPreset } from "../../../model/identity-providers.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { IdentityProviderTile } from "../identity-provider-tile.tsx";

function renderTile(id: string, { selected = false }: { selected?: boolean } = {}) {
  const onPick = vi.fn();
  const rendered = renderWithSsoHost(
    <IdentityProviderTile
      preset={identityProviderPreset(id)}
      selected={selected}
      onPick={onPick}
    />,
  );

  return { ...rendered, onPick };
}

afterEach(cleanup);

describe("given a product the icon set carries", () => {
  it("shows its own mark beside its name", () => {
    renderTile("okta");

    expect(screen.getByTestId("identity-provider-mark-okta").querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Okta")).toBeTruthy();
  });
});

describe("given a product the icon set has no mark for", () => {
  it("draws its initials rather than inventing a logo", () => {
    renderTile("onelogin");

    const mark = screen.getByTestId("identity-provider-mark-onelogin");

    expect(mark.querySelector("svg")).toBeNull();
    expect(mark.textContent).toBe("Ol");
  });
});

describe("given the tile the administrator picked", () => {
  it("says so to a reader and to a screen reader alike", () => {
    renderTile("entra", { selected: true });

    expect(screen.getByTestId("identity-provider-entra").getAttribute("aria-pressed")).toBe("true");
  });

  it("hands the choice back when it is pressed", async () => {
    const { onPick } = renderTile("saml");
    await userEvent.click(screen.getByTestId("identity-provider-saml"));

    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
