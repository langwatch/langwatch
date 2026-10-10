/**
 * @vitest-environment jsdom
 * The provider's issuer on the connection's first step: shown without its
 * scheme, whole on the hover, and copyable whole.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithSsoHost } from "../../../testing.tsx";
import { IssuerRow } from "../issuer-row.tsx";

afterEach(cleanup);

describe("given a connection with an issuer", () => {
  it("drops the scheme from the display and keeps the whole address on the hover", () => {
    renderWithSsoHost(<IssuerRow issuer="https://acme.okta.com" />);

    const shown = screen.getByText("acme.okta.com");
    expect(shown.getAttribute("title")).toBe("https://acme.okta.com");
  });

  it("puts the whole address on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(void 0);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWithSsoHost(<IssuerRow issuer="https://acme.okta.com" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy issuer address" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://acme.okta.com"));
  });

  describe("when the reader may edit the identity provider settings", () => {
    it("offers the edit beside the issuer", () => {
      const onEdit = vi.fn();
      renderWithSsoHost(<IssuerRow issuer="https://acme.okta.com" onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId("identity-provider-edit"));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no edit is offered", () => {
    it("shows no edit control", () => {
      renderWithSsoHost(<IssuerRow issuer="https://acme.okta.com" />);

      expect(screen.queryByTestId("identity-provider-edit")).toBeNull();
    });
  });
});
