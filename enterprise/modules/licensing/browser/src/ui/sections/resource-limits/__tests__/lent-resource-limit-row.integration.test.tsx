/**
 * @vitest-environment jsdom
 *
 * The usage row licensing lends billing and organization.
 * @see specs/licensing/seat-reconciliation.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LentResourceLimitRow } from "../lent-resource-limit-row.tsx";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

describe("the lent usage row", () => {
  describe("when a borrower names a limit type", () => {
    /** @scenario The member list shows how many seats of each kind are in use */
    it("labels it as licensing names it", () => {
      render(<LentResourceLimitRow limitType="membersLite" current={1} max={3} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Lite Members")).toBeInTheDocument();
      expect(screen.getByText("/ 3")).toBeInTheDocument();
    });

    /** @scenario The member list shows how many seats of each kind are in use */
    it("says unlimited rather than a number nobody can read", () => {
      render(
        <LentResourceLimitRow limitType="members" current={40} max={Number.MAX_SAFE_INTEGER} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Team Members")).toBeInTheDocument();
      expect(screen.getByText("/ Unlimited")).toBeInTheDocument();
    });
  });

  describe("when a borrower passes its own label", () => {
    it("shows that label", () => {
      render(<LentResourceLimitRow label="Traces / Month" current={5} />, { wrapper: Wrapper });

      expect(screen.getByText("Traces / Month")).toBeInTheDocument();
    });
  });
});
