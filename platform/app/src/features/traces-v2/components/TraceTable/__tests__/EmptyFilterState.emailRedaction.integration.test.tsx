/**
 * @vitest-environment jsdom
 *
 * A search for an email address finds nothing under the default privacy
 * settings, because the address was replaced with a marker before the trace
 * was stored. The empty state says so, with the settings link, when the
 * query carries an address and the project redacts PII. See
 * specs/traces-v2/email-search-redaction-notice.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const snapshotQuery = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: { dataPrivacy: { getSnapshot: { useQuery: snapshotQuery } } },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("../QueryBreakdownChips", () => ({ QueryBreakdownChips: () => null }));

import { useFilterStore } from "../../../stores/filterStore";
import { EmptyFilterState } from "../EmptyFilterState";

function piiLevel(level: string) {
  snapshotQuery.mockImplementation(
    (_input: unknown, options?: { enabled?: boolean }) =>
      options?.enabled === false
        ? { data: undefined, isLoading: false }
        : { data: { effective: { pii: { level } } }, isLoading: false },
  );
}

function renderEmptyState({ query }: { query: string }) {
  useFilterStore.setState({ queryText: query });
  render(
    <ChakraProvider value={defaultSystem}>
      <EmptyFilterState />
    </ChakraProvider>,
  );
}

const NOTICE = /email addresses are redacted before a trace is stored/i;

describe("EmptyFilterState after a search for an email address", () => {
  beforeEach(() => {
    snapshotQuery.mockReset();
  });

  afterEach(() => {
    cleanup();
    useFilterStore.setState({ queryText: "" });
  });

  describe("given the project redacts PII", () => {
    beforeEach(() => piiLevel("essential"));

    describe("when the query carries an email address", () => {
      /** @scenario "An email-shaped query with no results shows the redaction notice" */
      it("says addresses are redacted, what to search by, and links to the settings", () => {
        renderEmptyState({ query: "priya.raman@northwind.example" });

        expect(screen.getByText(NOTICE)).toBeInTheDocument();
        expect(
          screen.getByText(/thread id, a trace id or a name/i),
        ).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
          "href",
          "/settings/data-privacy",
        );
      });
    });

    describe("when the query is ordinary text", () => {
      /** @scenario "A non-email query with no results shows no notice" */
      it("shows no notice and does not read the privacy settings", () => {
        renderEmptyState({ query: "refund never arrived" });

        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
        expect(snapshotQuery).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project has PII redaction disabled", () => {
    beforeEach(() => piiLevel("disabled"));

    describe("when the query carries an email address", () => {
      /** @scenario "The notice is not shown when PII redaction is disabled" */
      it("shows no notice", () => {
        renderEmptyState({ query: "priya.raman@northwind.example" });

        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      });
    });
  });
});
