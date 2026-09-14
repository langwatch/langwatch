/**
 * @vitest-environment jsdom
 *
 * The waiting card, at the moment the link is out: it stands on the solid
 * surface rather than the glass, and for the mailboxes everyone recognizes
 * it offers the door — a real anchor to the provider's inbox, in a new tab.
 * A company's own domain gets no guess.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CheckYourEmail } from "../CheckYourEmail";

const renderCard = (email: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CheckYourEmail email={email} what="Open it to confirm your address." />
    </ChakraProvider>,
  );

afterEach(() => cleanup());

describe("given I asked for a confirmation link", () => {
  describe("when the check-your-email card is shown", () => {
    /** @scenario "The email-sent card stands on a solid floor" */
    it("draws the card on the solid surface, not the glass", () => {
      const { container } = renderCard("sam@acme-widgets.example");

      const card = container.querySelector("[data-auth-card]");
      expect(card).not.toBeNull();
      expect(card?.className).toContain("lw-auth-card--solid");
    });
  });
});

describe("given I asked for a confirmation link at a gmail.com address", () => {
  describe("when the check-your-email card is shown", () => {
    /** @scenario "A common mailbox gets a door straight to it" */
    it("offers Go to inbox as a new-tab anchor to the provider's inbox", () => {
      renderCard("sam@gmail.com");

      const door = screen.getByTestId("go-to-inbox");
      expect(door).toHaveTextContent("Go to inbox");
      expect(door.tagName).toBe("A");
      expect(door).toHaveAttribute("href", "https://mail.google.com/");
      expect(door).toHaveAttribute("target", "_blank");
      expect(door).toHaveAttribute("rel", "noreferrer");
    });
  });
});

describe("given I asked for a confirmation link at an address on my company's own domain", () => {
  describe("when the check-your-email card is shown", () => {
    /** @scenario "A company domain gets no inbox guess" */
    it("offers no inbox door", () => {
      renderCard("sam@acme-widgets.example");

      expect(screen.queryByTestId("go-to-inbox")).toBeNull();
    });
  });
});
