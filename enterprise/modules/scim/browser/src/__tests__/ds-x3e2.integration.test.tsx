/**
 * @vitest-environment jsdom
 * The operator's directory-sync list: paged by number against a known total, and each row
 * opened from its keyboard target as well as by a click on the row.
 * @see enterprise/modules/scim/specs/scim-reconciliation-surfaces.feature
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAll, mockGetById, mockIdentities } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGetById: vi.fn(),
  mockIdentities: vi.fn(),
}));

vi.mock("../behavior/scim-api.ts", () => ({
  scimApi: {
    scimOversight: {
      getAll: { useQuery: mockGetAll },
      getById: { useQuery: mockGetById },
      directoryIdentities: { useQuery: mockIdentities },
      redriveRetiredApply: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ scimOversight: { invalidate: vi.fn() } }),
  },
}));

import { FakeScimHost, renderWithScimHost } from "../testing.tsx";
import DirectorySyncView from "../ui/sections/directory-sync-view.screen.tsx";

const SYNC = {
  connectionId: "acme-okta",
  organizationId: "org_acme",
  organizationName: "Acme",
  state: "SYNCING",
  lastPushedAtMs: 1_756_000_000_000,
  revokedCause: null,
  lastFailure: null,
  deadLetters: [],
  updatedAtMs: 1_756_000_000_000,
};

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockReturnValue({
    data: { syncs: [SYNC], total: 60 },
    isLoading: false,
    isError: false,
  });
  mockGetById.mockReturnValue({ data: SYNC, isLoading: false });
  mockIdentities.mockReturnValue({ data: [], isLoading: false });
});

describe("the operator's directory sync list", () => {
  describe("when the organisation has more syncs than one page", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("pages by number against the known total and asks the server for the next page", async () => {
      renderWithScimHost(<DirectorySyncView />, new FakeScimHost({ query: {} }));

      fireEvent.click(screen.getByTestId("pagination-page-2"));

      await waitFor(() =>
        expect(mockGetAll).toHaveBeenLastCalledWith({ page: 1, pageSize: 25, search: void 0 }),
      );
    });
  });

  describe("when an operator opens a row from its keyboard target", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("asks the route to open that connection", () => {
      const host = new FakeScimHost({ query: {} });
      renderWithScimHost(<DirectorySyncView />, host);

      fireEvent.click(screen.getByRole("button", { name: "Open Acme" }));

      expect(host.queries.at(-1)).toEqual({ connection: "acme-okta" });
    });
  });
});
