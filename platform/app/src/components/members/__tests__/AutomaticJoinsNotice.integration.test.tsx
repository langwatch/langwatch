/**
 * @vitest-environment jsdom
 *
 * The in-product half of telling the admins after the fact (D12).
 *
 * The mail goes out the moment somebody walks in; this is what an admin who
 * was not reading their inbox sees, in the same panel as the requests they
 * answer by hand. It has to name who joined and say WHAT admitted them,
 * because that is the one question a surprising member raises — and the
 * answer is also the way to stop it happening again.
 *
 * Spec: specs/identity/domain-auto-join.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  type AutomaticJoin,
  AutomaticJoinsNotice,
} from "../AutomaticJoinsNotice";

const joinedAt = new Date("2026-08-24T10:00:00.000Z");

const renderNotice = (joins: AutomaticJoin[]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AutomaticJoinsNotice joins={joins} />
    </ChakraProvider>,
  );

afterEach(() => cleanup());

describe("given colleagues who walked in on the domain setting", () => {
  describe("when an administrator opens the members area", () => {
    /** @scenario The admins are told after the fact, straight away */
    it("names who joined and says the domain setting admitted them", () => {
      renderNotice([
        {
          joinRequestId: "jreq_1",
          name: "Sam",
          domain: "acme.com",
          joinedAt,
        },
      ]);

      expect(screen.getByTestId("automatic-joins-notice")).toBeInTheDocument();
      expect(screen.getByText("Sam")).toBeInTheDocument();
      expect(screen.getByText("acme.com")).toBeInTheDocument();
      // What admitted them, in the reader's terms and without naming any
      // internals — and that nobody approved it, which is the surprising part.
      expect(
        screen.getByText(/domain setting admitted them/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Nobody approved these/i)).toBeInTheDocument();
    });

    /** @scenario The admins are told after the fact, straight away */
    it("counts them when more than one walked in", () => {
      renderNotice([
        { joinRequestId: "jreq_1", name: "Sam", domain: "acme.com", joinedAt },
        { joinRequestId: "jreq_2", name: "Ivan", domain: "acme.com", joinedAt },
      ]);

      expect(
        screen.getByText("2 colleagues joined automatically"),
      ).toBeInTheDocument();
    });
  });
});

describe("given an organization nobody has walked into", () => {
  describe("when an administrator opens the members area", () => {
    it("renders nothing at all", () => {
      const { container } = renderNotice([]);

      expect(container.innerHTML).toBe("");
    });
  });
});
