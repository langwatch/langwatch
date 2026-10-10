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

const mintButton = () =>
  screen.getByRole("button", { name: "Create and copy a personal access token" });

async function chooseExpiration({
  user,
  label,
}: {
  user: ReturnType<typeof userEvent.setup>;
  label: string;
}) {
  await user.click(screen.getByText("Choose when this token expires"));
  await user.click(await screen.findByRole("option", { name: label }));
}

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
      const user = userEvent.setup();

      await chooseExpiration({ user, label: "No expiration" });
      await user.click(mintButton());

      await waitFor(() => expect(screen.getByText(/You can close this tab/)).toBeInTheDocument());
      expect(host.copies).toEqual(["lw-pat-123"]);
    });
  });
});

describe("given a reader who has not chosen an expiry", () => {
  describe("when the page opens", () => {
    /** @scenario "The authorize page mints nothing until an expiry is chosen" */
    it("offers the create drawer's choices, preselects none, and keeps the mint disabled", async () => {
      const host = new FakeAuthorizeHost({ token: "lw-pat-123" });
      renderWithAuthorizeHost(<Authorize />, host);
      const user = userEvent.setup();

      expect(screen.getByTestId("authorize-expiration-hint")).toHaveTextContent(
        "Choose when this token expires",
      );
      expect(mintButton()).toBeDisabled();
      await user.click(mintButton());
      expect(host.mints).toEqual([]);

      await user.click(screen.getByText("Choose when this token expires"));
      const offered = (await screen.findAllByRole("option")).map((option) => option.textContent);
      expect(offered).toEqual([
        "No expiration",
        "7 days",
        "30 days",
        "60 days",
        "90 days",
        "Custom...",
      ]);
      await user.click(screen.getByRole("option", { name: "No expiration" }));

      expect(screen.queryByTestId("authorize-expiration-hint")).toBeNull();
      expect(mintButton()).toBeEnabled();
    });
  });

  describe("when they choose a preset and mint", () => {
    /** @scenario "The authorize page mints nothing until an expiry is chosen" */
    it("mints with the chosen expiry, and with none for No expiration", async () => {
      const host = new FakeAuthorizeHost({ token: "lw-pat-123" });
      renderWithAuthorizeHost(<Authorize />, host);
      const user = userEvent.setup();
      const before = Date.now();

      await chooseExpiration({ user, label: "30 days" });
      await user.click(mintButton());

      await waitFor(() => expect(host.mints).toHaveLength(1));
      const days = ((host.mints[0]?.epochMilliseconds ?? 0) - before) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(30);
      expect(days).toBeLessThan(30.01);
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
      const user = userEvent.setup();

      await chooseExpiration({ user, label: "No expiration" });
      await user.click(mintButton());

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
