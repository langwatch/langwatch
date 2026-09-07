/**
 * @vitest-environment jsdom
 *
 * The operator's directory-sync surface (ADR-122 — see
 * specs/identity/scim-reconciliation-surfaces.feature).
 *
 * What is under test is that this is ONE MORE PAGE OF AN EXISTING KIND: the
 * same back-office list with its search and paging, the same drawer beside
 * it, the same row overflow menu. And that its depth is the operator's — the
 * reason code, the attempt count, and the `externalId` the directory knows a
 * person by, which the organization view never shows.
 *
 * The tRPC client is doubled at the boundary. What this drives is the view's
 * own rendering; the router's gating is a server concern and is asserted in
 * `src/server/api/routers/__tests__/scimOversight.gating.unit.test.ts`.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAll, mockGetById, mockIdentities, mockRedrive, mockRouter } =
  vi.hoisted(() => ({
    mockGetAll: vi.fn(),
    mockGetById: vi.fn(),
    mockIdentities: vi.fn(),
    mockRedrive: vi.fn(),
    mockRouter: vi.fn(),
  }));

const apiDouble = {
  api: {
    scimOversight: {
      getAll: { useQuery: mockGetAll },
      getById: { useQuery: mockGetById },
      directoryIdentities: { useQuery: mockIdentities },
      redriveRetiredApply: {
        useMutation: () => ({ mutate: mockRedrive, isPending: false }),
      },
    },
    useContext: () => ({ scimOversight: { invalidate: vi.fn() } }),
    useUtils: () => ({ scimOversight: { invalidate: vi.fn() } }),
  },
};

vi.mock("~/utils/api", () => apiDouble);
vi.mock("~/utils/compat/next-router", () => ({ useRouter: mockRouter }));

const T0 = 1_756_000_000_000;

const DEAD_LETTER = {
  op: "deactivate_user",
  errorCode: "offboard_incomplete",
  attempts: 5,
  retiredAtMs: T0 + 2_000,
  redrivenAtMs: null,
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
  connectionId: "globex-okta",
  organizationId: "org_globex",
  organizationName: "Globex",
  state: "SYNCING",
  lastPushedAtMs: T0 + 500,
  revokedCause: null,
  lastFailure: null,
  deadLetters: [],
  updatedAtMs: T0 + 500,
};

const draw = (node: ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mockRouter.mockReturnValue({
    query: {},
    replace: vi.fn(),
  });
  mockGetAll.mockReturnValue({
    data: { syncs: [ACME_SYNC, GLOBEX_SYNC], total: 2 },
    isLoading: false,
    isFetching: false,
    error: null,
  });
  mockGetById.mockReturnValue({ data: ACME_SYNC, isLoading: false });
  mockIdentities.mockReturnValue({ data: [], isLoading: false });
});

describe("the operator's directory sync surface", () => {
  describe("when an operator opens it", () => {
    /** @scenario "Every customer's connections are one operator list" */
    it("lists connections across organizations with their states, and searches and pages the way the other operator lists do", async () => {
      const { default: DirectorySyncView } = await import(
        "../DirectorySyncView"
      );

      draw(<DirectorySyncView />);

      // Two customers, one list.
      expect(screen.getByText("Acme")).toBeTruthy();
      expect(screen.getByText("Globex")).toBeTruthy();
      expect(screen.getByText("error")).toBeTruthy();
      expect(screen.getByText("syncing")).toBeTruthy();

      // The back office's own search and paging, asked for the same way the
      // connections list asks.
      expect(
        screen.getByPlaceholderText(
          "Search by connection, organization or state",
        ),
      ).toBeTruthy();
      expect(mockGetAll).toHaveBeenCalledWith({
        page: 0,
        pageSize: 25,
        search: undefined,
      });
    });
  });

  describe("when an operator opens a failure", () => {
    /** @scenario "A dead letter opens to the intent behind it" */
    it("shows the retired intent, its error and its retry history", async () => {
      mockRouter.mockReturnValue({
        query: { connection: "acme-okta" },
        replace: vi.fn(),
      });
      const { default: DirectorySyncView } = await import(
        "../DirectorySyncView"
      );

      draw(<DirectorySyncView />);

      // The intent (the operation and the person), its reason code, and how
      // many attempts it took before it stopped being retried.
      // Once on the row as the standing failure, once in the drawer as the
      // retired intent — both are the operator's to read.
      expect(
        screen.getAllByText("deactivate_user · offboard_incomplete").length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText(/5 attempts · retired .* · user_sam/),
      ).toBeTruthy();
      // And the one act this surface offers.
      expect(
        screen.getByRole("button", { name: /send through again/i }),
      ).toBeTruthy();
    });
  });

  describe("when an operator opens a person the directory manages", () => {
    /** @scenario "The mapping detail is the operator's, not the customer's" */
    it("shows the identifier the directory knows them by, per connection", async () => {
      mockRouter.mockReturnValue({
        query: { connection: "acme-okta" },
        replace: vi.fn(),
      });
      mockIdentities.mockReturnValue({
        data: [
          { externalId: "u-1", userId: "user_sam", updatedAtMs: T0 + 3_000 },
        ],
        isLoading: false,
      });
      const { default: DirectorySyncView } = await import(
        "../DirectorySyncView"
      );

      draw(<DirectorySyncView />);

      expect(screen.getByText("u-1")).toBeTruthy();
      expect(screen.getByText("user_sam")).toBeTruthy();
      // Asked per connection, never by the identifier alone — the same
      // identifier on two connections is two different people.
      expect(mockIdentities).toHaveBeenCalledWith(
        { connectionId: "acme-okta" },
        expect.anything(),
      );
    });
  });

  describe("given a dead letter that has already been sent through", () => {
    it("says so and offers no control that could only answer that it is done", async () => {
      mockRouter.mockReturnValue({
        query: { connection: "acme-okta" },
        replace: vi.fn(),
      });
      mockGetById.mockReturnValue({
        data: {
          ...ACME_SYNC,
          deadLetters: [{ ...DEAD_LETTER, redrivenAtMs: T0 + 4_000 }],
        },
        isLoading: false,
      });
      const { default: DirectorySyncView } = await import(
        "../DirectorySyncView"
      );

      draw(<DirectorySyncView />);

      expect(screen.getByText(/sent through again/i)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: /send through again/i }),
      ).toBeNull();
    });
  });
});
