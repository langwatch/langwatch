/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { MemberSeatUsageLine } from "../MemberSeatUsageLine";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<MemberSeatUsageLine/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when pending invites reserve part of the seats", () => {
    /** @scenario The member cap message itemizes members and pending invites */
    it("itemizes members and pending invites against the seat total", () => {
      render(
        <MemberSeatUsageLine
          memberCount={4}
          pendingInviteCount={2}
          current={6}
          max={6}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("member-seat-usage")).toHaveTextContent(
        "6 of 6 seats used — 4 members + 2 pending invites",
      );
    });
  });

  describe("when there are no pending invites", () => {
    it("shows only the member count", () => {
      render(
        <MemberSeatUsageLine
          memberCount={4}
          pendingInviteCount={0}
          current={4}
          max={6}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("member-seat-usage")).toHaveTextContent(
        "4 of 6 seats used — 4 members",
      );
    });
  });
});
