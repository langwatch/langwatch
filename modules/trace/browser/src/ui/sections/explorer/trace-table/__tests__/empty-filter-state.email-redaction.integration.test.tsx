/**
 * @vitest-environment jsdom
 *
 * An email-shaped search explains redaction when the project redacts PII.
 * See specs/traces-v2/email-search-redaction-notice.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useExplorerStore } from "@langwatch/trace-browser-kit";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { EmptyFilterState } from "../empty-filter-state.tsx";

const snapshotQuery = vi.hoisted(() => vi.fn());

vi.mock("../../../../../behavior/trace-api.ts", () => ({
  api: { dataPrivacy: { getSnapshot: { useQuery: snapshotQuery } } },
}));

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../../../../elements/next-link.tsx", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../hooks/use-explorer-counts.ts", () => ({
  useExplorerCounts: () => ({ instantEval: null }),
}));

vi.mock("../../hooks/use-instant-eval-runs.ts", () => ({
  useInstantEvalRuns: () => ({ chips: [] }),
}));

vi.mock("../query-breakdown-chips.tsx", () => ({
  QueryBreakdownChips: () => null,
}));

function piiLevel(level: string, entities: string[] = []) {
  snapshotQuery.mockImplementation((_input: unknown, options?: { enabled?: boolean }) =>
    options?.enabled === false
      ? { data: undefined, isLoading: false }
      : { data: { effective: { pii: { level, entities } } }, isLoading: false },
  );
}

function renderEmptyState({ query }: { query: string }) {
  useExplorerStore.getState().applyQueryText(query);
  render(
    <ChakraProvider value={defaultSystem}>
      <EmptyFilterState />
    </ChakraProvider>,
  );
}

const NOTICE = /email addresses are redacted before a trace is stored/i;

describe("<EmptyFilterState /> after a search for an email address", () => {
  beforeEach(() => {
    snapshotQuery.mockReset();
    useExplorerStore.getState().clearAll();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given the project redacts PII", () => {
    beforeEach(() => piiLevel("essential"));

    describe("when the query carries an email address", () => {
      /** @scenario "An email-shaped query with no results shows the redaction notice" */
      it("says addresses are redacted, what to search by, and links to the settings", () => {
        renderEmptyState({ query: "priya.raman@northwind.example" });

        expect(screen.getByText(NOTICE)).toBeInTheDocument();
        expect(screen.getByText(/thread id, a trace id or a name/i)).toBeInTheDocument();
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

  describe("given the project redacts a custom set of identifiers", () => {
    describe("when that set leaves email addresses out", () => {
      /** @scenario "A custom PII level that leaves email addresses out shows no notice" */
      it("shows no notice, because the addresses were stored in full", () => {
        piiLevel("custom", ["BR_CPF", "PHONE_NUMBER"]);

        renderEmptyState({ query: "priya.raman@northwind.example" });

        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
      });
    });

    describe("when that set names email addresses", () => {
      /** @scenario "A custom PII level that names email addresses shows the notice" */
      it("says addresses are redacted", () => {
        piiLevel("custom", ["EMAIL_ADDRESS"]);

        renderEmptyState({ query: "priya.raman@northwind.example" });

        expect(screen.getByText(NOTICE)).toBeInTheDocument();
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
