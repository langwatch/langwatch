/**
 * @vitest-environment jsdom
 *
 * The automations list's "Watches" and "Delivery" cells: an automation with
 * no condition must not read as harmless, and an email address wraps at its
 * seams rather than mid-word.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/api", () => ({
  api: { useUtils: () => ({}) },
}));

import { EmailList, TraceFilterCell } from "../AutomationTableCells";

afterEach(cleanup);

const renderCell = ({
  filterQuery,
  filters,
}: {
  filterQuery: string | null;
  filters: unknown;
}) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TraceFilterCell
        checks={[]}
        filterQuery={filterQuery}
        filters={filters}
        applyChecks={() => null}
      />
    </ChakraProvider>,
  );

describe("TraceFilterCell", () => {
  describe("given an automation with no query and empty filters", () => {
    /** @scenario "An automation with no condition is flagged as matching every trace" */
    it("flags that it matches every trace", () => {
      renderCell({ filterQuery: null, filters: "{}" });

      expect(screen.getByTestId("matches-every-trace")).toHaveTextContent(
        "Matches every trace",
      );
    });
  });

  describe("given an automation with a query", () => {
    it("shows the query and no warning", () => {
      renderCell({ filterQuery: "status:error", filters: "{}" });

      expect(screen.getByText("status:error")).toBeInTheDocument();
      expect(screen.queryByTestId("matches-every-trace")).toBeNull();
    });
  });
});

describe("EmailList", () => {
  /** @scenario "The Delivery column never breaks an email address mid-word" */
  it("offers line breaks only after the @ and before each dot", () => {
    const { container } = render(
      <EmailList emails={["admin@haven.localhost", "ops@acme.io"]} />,
    );

    expect(container.textContent).toBe("admin@haven.localhost, ops@acme.io");
    // admin@ | haven | .localhost and ops@ | acme | .io
    expect(container.querySelectorAll("wbr")).toHaveLength(4);
  });
});
