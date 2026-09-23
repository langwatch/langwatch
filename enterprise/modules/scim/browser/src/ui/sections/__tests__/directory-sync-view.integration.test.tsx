/**
 * @vitest-environment jsdom
 * The operator's directory-sync surface: one more back-office list, with the
 * operator's depth. The router's gating is the server's, asserted in scim-process.
 * @see specs/identity/scim-reconciliation-surfaces.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAll, mockGetById, mockIdentities, mockRedrive } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockGetById: vi.fn(),
  mockIdentities: vi.fn(),
  mockRedrive: vi.fn(),
}));

vi.mock("../../../behavior/scim-api.ts", () => ({
  scimApi: {
    scimOversight: {
      getAll: { useQuery: mockGetAll },
      getById: { useQuery: mockGetById },
      directoryIdentities: { useQuery: mockIdentities },
      redriveRetiredApply: { useMutation: () => ({ mutate: mockRedrive, isPending: false }) },
    },
    useUtils: () => ({ scimOversight: { invalidate: vi.fn() } }),
  },
}));

import { FakeScimHost, renderWithScimHost } from "../../../testing.tsx";
import DirectorySyncView from "../directory-sync-view.screen.tsx";

const T0 = 1_756_000_000_000;

const DEAD_LETTER = {
  op: "deactivate_user",
  errorCode: "offboard_incomplete",
  attempts: 5,
  retiredAtMs: T0 + 2_000,
  redrivenAtMs: null as number | null,
  userId: "user_sam",
  occurredAtMs: T0 + 2_000,
};

const ACME_SYNC = {
  connectionId: "acme-okta",
  organizationId: "org_acme",
  organizationName: "Acme",
  state: "ERROR",
  lastPushedAtMs: T0,
  revokedCause: null,
  lastFailure: DEAD_LETTER,
  deadLetters: [DEAD_LETTER],
  updatedAtMs: T0 + 2_000,
};

const GLOBEX_SYNC = {
  ...ACME_SYNC,
  connectionId: "globex-okta",
  organizationId: "org_globex",
  organizationName: "Globex",
  state: "SYNCING",
  lastFailure: null,
  deadLetters: [],
};

const drawOpenOn = (connection?: string) =>
  renderWithScimHost(
    <DirectorySyncView />,
    new FakeScimHost({ query: connection ? { connection } : {} }),
  );

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAll.mockReturnValue({
    data: { syncs: [ACME_SYNC, GLOBEX_SYNC], total: 2 },
    isLoading: false,
    isError: false,
  });
  mockGetById.mockReturnValue({ data: ACME_SYNC, isLoading: false });
  mockIdentities.mockReturnValue({ data: [], isLoading: false });
});

describe("the operator's directory sync surface", () => {
  describe("when an operator opens it", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("lists connections across organizations with their states, searched and paged like the other lists", () => {
      drawOpenOn();

      expect(screen.getByText("Acme")).toBeTruthy();
      expect(screen.getByText("Globex")).toBeTruthy();
      expect(screen.getByText("error")).toBeTruthy();
      expect(screen.getByText("syncing")).toBeTruthy();
      expect(
        screen.getByPlaceholderText("Search by connection, organization or state"),
      ).toBeTruthy();
      expect(mockGetAll).toHaveBeenCalledWith({ page: 0, pageSize: 25, search: void 0 });
    });
  });

  describe("when an operator opens a failure", () => {
    /** @scenario "A dead letter opens to the intent behind it" */
    it("shows the retired intent, its error and its retry history", () => {
      drawOpenOn("acme-okta");

      expect(screen.getAllByText("deactivate_user · offboard_incomplete").length).toBeGreaterThan(
        0,
      );
      expect(screen.getByText(/5 attempts · retired .* · user_sam/)).toBeTruthy();
      expect(screen.getByRole("button", { name: /send through again/i })).toBeTruthy();
    });
  });

  describe("when an operator opens a person the directory manages", () => {
    /** @scenario "The mapping detail is the operator's, not the customer's" */
    it("shows the identifier the directory knows them by, per connection", () => {
      mockIdentities.mockReturnValue({
        data: [{ externalId: "u-1", userId: "user_sam", updatedAtMs: T0 + 3_000 }],
        isLoading: false,
      });
      drawOpenOn("acme-okta");

      expect(screen.getByText("u-1")).toBeTruthy();
      expect(screen.getByText("user_sam")).toBeTruthy();
      expect(mockIdentities).toHaveBeenCalledWith({ connectionId: "acme-okta" }, expect.anything());
    });
  });

  describe("given a dead letter that has already been sent through", () => {
    it("says so and offers no control that could only answer that it is done", () => {
      mockGetById.mockReturnValue({
        data: { ...ACME_SYNC, deadLetters: [{ ...DEAD_LETTER, redrivenAtMs: T0 + 4_000 }] },
        isLoading: false,
      });
      drawOpenOn("acme-okta");

      expect(screen.getByText(/sent through again/i)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /send through again/i })).toBeNull();
    });
  });
});
