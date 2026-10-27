/**
 * @vitest-environment jsdom
 * The list's "Watches" and "Delivery" cells: the trace-filter cell shows the
 * notice its caller decides on; an email address wraps at its seams.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmailList, TraceFilterCell } from "../ui/elements/automation-table-cells.tsx";

afterEach(cleanup);

const renderCell = ({
  notice,
  filterQuery,
  filters,
}: {
  notice?: React.ReactNode;
  filterQuery: string | null;
  filters: unknown;
}) =>
  renderWithDesignSystem(
    <TraceFilterCell notice={notice} checks={null} filterQuery={filterQuery} filters={filters} />,
  );

describe("TraceFilterCell", () => {
  describe("given the caller flags the row as matching every trace", () => {
    it("shows the notice under the subject", () => {
      renderCell({
        notice: <span data-testid="matches-every-trace">Matches every trace</span>,
        filterQuery: null,
        filters: "{}",
      });

      expect(screen.getByText("Trace filter")).toBeInTheDocument();
      expect(screen.getByTestId("matches-every-trace")).toHaveTextContent("Matches every trace");
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
    const { container } = render(<EmailList emails={["admin@haven.localhost", "ops@acme.io"]} />);

    expect(container.textContent).toBe("admin@haven.localhost, ops@acme.io");
    // admin@ | haven | .localhost and ops@ | acme | .io
    expect(container.querySelectorAll("wbr")).toHaveLength(4);
  });
});
