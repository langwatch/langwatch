/**
 * @vitest-environment jsdom
 * The /authorize page: a personal access token is minted on the click, never on mount.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeAuthorizeHost, renderWithAuthorizeHost } from "../../../testing.tsx";
import Authorize from "../authorize-screen.tsx";

afterEach(() => cleanup());

describe("given a reader who may mint a personal access token", () => {
  describe("when the page opens", () => {
    it("offers a create button and shows no token", () => {
      renderWithAuthorizeHost(<Authorize />, new FakeAuthorizeHost({ token: "lw-pat-123" }));

      expect(screen.getByRole("heading", { name: "Authorize" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Create and copy a personal access token" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("lw-pat-123")).toBeNull();
      expect(screen.queryByText(/close this tab/)).toBeNull();
    });
  });

  describe("when they create the token", () => {
    /** @scenario The authorize page mints a personal access token */
    it("copies the minted token and says the tab can be closed", async () => {
      const host = new FakeAuthorizeHost({ token: "lw-pat-123" });
      renderWithAuthorizeHost(<Authorize />, host);

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Create and copy a personal access token" }));

      await waitFor(() => expect(screen.getByText(/You can close this tab/)).toBeInTheDocument());
      expect(host.copies).toEqual(["lw-pat-123"]);
    });
  });
});

describe("given a browser that refuses the clipboard write", () => {
  describe("when they create the token", () => {
    it("keeps the token on screen with a manual copy button", async () => {
      renderWithAuthorizeHost(
        <Authorize />,
        new FakeAuthorizeHost({ token: "lw-pat-123", copyFails: true }),
      );

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Create and copy a personal access token" }));

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Copy personal access token" }),
        ).toBeInTheDocument(),
      );
      expect(screen.getByText(/Copy this token now/)).toBeInTheDocument();
      expect(screen.queryByText(/close this tab/)).toBeNull();
    });
  });
});

describe("given a reader with more than one project", () => {
  describe("when the page opens", () => {
    it("draws the lent project switcher inside the card", () => {
      renderWithAuthorizeHost(
        <Authorize />,
        new FakeAuthorizeHost({
          token: "lw-pat-123",
          projectSwitcher: <button type="button">Project A</button>,
        }),
      );

      expect(screen.getByRole("button", { name: "Project A" })).toBeInTheDocument();
    });
  });
});

describe("given a signed-out reader", () => {
  describe("when the page opens", () => {
    it("sends them to sign in and back to /authorize, showing no token", () => {
      const host = new FakeAuthorizeHost({ status: "unauthenticated", token: "lw-pat-123" });
      renderWithAuthorizeHost(<Authorize />, host);

      expect(host.moves).toEqual([
        { kind: "replace", to: "/auth/signin?callbackUrl=%2Fauthorize" },
      ]);
      expect(
        screen.queryByRole("button", { name: "Create and copy a personal access token" }),
      ).toBeNull();
    });
  });
});
