/**
 * @vitest-environment jsdom
 * The waiting card: for the mailboxes everyone recognizes it offers the door,
 * a real anchor to the provider's inbox in a new tab. A company domain gets no guess.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CheckYourEmail } from "../check-your-email.tsx";

const renderCard = (email: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <CheckYourEmail email={email} what="Open it to confirm your address." />
    </ChakraProvider>,
  );

afterEach(() => cleanup());

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

    /** @scenario "A recognized mailbox wears its own mark" */
    it("carries that provider's mark, hidden from a screen reader", () => {
      renderCard("sam@gmail.com");

      const mark = screen.getByTestId("inbox-mark");
      expect(mark).toHaveAttribute("data-provider", "gmail");
      expect(mark.querySelector("svg")).not.toBeNull();
      expect(mark).toHaveAttribute("aria-hidden", "true");
      expect(screen.getByTestId("go-to-inbox")).toContainElement(mark);
    });

    it.each([
      ["sam@hotmail.com", "outlook"],
      ["sam@yahoo.com", "yahoo"],
      ["sam@me.com", "icloud"],
      ["sam@proton.me", "proton"],
    ])("marks %s as %s", (email, provider) => {
      renderCard(email);

      expect(screen.getByTestId("inbox-mark")).toHaveAttribute("data-provider", provider);
    });
  });
});

describe("given I asked for a confirmation link at an aol.com address", () => {
  describe("when the check-your-email card is shown", () => {
    /** @scenario "A mailbox we hold no mark for still opens, under a plain envelope" */
    it("still offers the door, under the plain envelope", () => {
      renderCard("sam@aol.com");

      expect(screen.getByTestId("go-to-inbox")).toHaveAttribute("href", "https://mail.aol.com/");
      expect(screen.getByTestId("inbox-mark")).toHaveAttribute("data-provider", "aol");
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
