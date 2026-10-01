/**
 * @vitest-environment jsdom
 * The /authorize page: the project's API key in a copy field, confirmed once copied.
 */

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { FakeAuthorizeHost, renderWithAuthorizeHost } from "../../../testing.tsx";
import Authorize from "../authorize-screen.tsx";

afterEach(() => cleanup());

describe("given a reader who may hold the project's API key", () => {
  describe("when the page opens", () => {
    it("shows the key in a copy field under a clear title", () => {
      renderWithAuthorizeHost(<Authorize />, new FakeAuthorizeHost({ apiKey: "sk-lw-123" }));

      expect(screen.getByRole("heading", { name: "Authorize" })).toBeInTheDocument();
      expect(screen.getByTestId("copy-input-api-key")).toHaveValue("sk-lw-123");
      expect(screen.queryByText(/close this tab/)).toBeNull();
    });
  });

  describe("when they copy the key", () => {
    it("confirms the copy and says the tab can be closed", async () => {
      renderWithAuthorizeHost(<Authorize />, new FakeAuthorizeHost({ apiKey: "sk-lw-123" }));

      await userEvent.setup().click(screen.getByTestId("copy-input-api-key"));

      await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
      expect(screen.getByText(/You can close this tab/)).toBeInTheDocument();
    });
  });
});

describe("given a reader with more than one project", () => {
  describe("when the page opens", () => {
    it("draws the lent project switcher inside the card", () => {
      renderWithAuthorizeHost(
        <Authorize />,
        new FakeAuthorizeHost({
          apiKey: "sk-lw-123",
          projectSwitcher: <button type="button">Project A</button>,
        }),
      );

      expect(screen.getByRole("button", { name: "Project A" })).toBeInTheDocument();
    });
  });
});

describe("given a signed-out reader", () => {
  describe("when the page opens", () => {
    it("sends them to sign in and back to /authorize, showing no key", () => {
      const host = new FakeAuthorizeHost({ status: "unauthenticated", apiKey: "sk-lw-123" });
      renderWithAuthorizeHost(<Authorize />, host);

      expect(host.moves).toEqual([
        { kind: "replace", to: "/auth/signin?callbackUrl=%2Fauthorize" },
      ]);
      expect(screen.queryByTestId("copy-input-api-key")).toBeNull();
    });
  });
});
