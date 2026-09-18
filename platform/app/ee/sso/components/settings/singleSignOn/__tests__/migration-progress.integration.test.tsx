/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { SelfServeMigrationView } from "@ee/sso/sso-self-serve.types";
import type { SsoConnectionLifecycleState } from "@langwatch/identity";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { routeMock, finalizeMock, progressMock, refetchMock } = vi.hoisted(
  () => ({
    routeMock: vi.fn(),
    finalizeMock: vi.fn(),
    progressMock: vi.fn(),
    refetchMock: vi.fn(),
  }),
);

vi.mock("~/utils/api", () => ({
  api: {
    ssoSetup: {
      selectMigrationRoute: {
        useMutation: () => ({ mutate: routeMock, isPending: false }),
      },
      finalizeLegacyMigration: {
        useMutation: () => ({ mutate: finalizeMock, isPending: false }),
      },
      getMigrationProgress: { useQuery: progressMock },
    },
    useUtils: () => ({
      ssoSetup: { getSetup: { invalidate: vi.fn() } },
    }),
  },
}));

import { MigrationProgress } from "../migration-progress";

function migrationWith(
  changes: Partial<SelfServeMigrationView> = {},
): SelfServeMigrationView {
  return {
    legacy: {
      connectionId: "ssoc_legacy",
      source: "legacy-grandfathered",
      providerId: "auth0",
    },
    replacement: {
      connectionId: "ssoc_direct",
      source: "self-serve",
      providerId: "Acme",
    },
    phase: "GRACE_LEGACY",
    selectedRoute: "legacy",
    inheritedDomains: [],
    testSignIn: { done: true, atMs: 100 },
    members: {
      activeCount: 1,
      linkedCount: 0,
      stragglers: [person(0)],
      nextCursor: null,
    },
    quietPeriod: { lastLegacyAuthenticationAtMs: null, complete: true },
    scim: { status: "not-applicable" },
    blockers: [],
    canFinalize: false,
    ...changes,
  };
}

function person(
  index: number,
): SelfServeMigrationView["members"]["stragglers"][number] {
  return {
    userId: `user_${String(index).padStart(3, "0")}`,
    name: `Member ${index}`,
    email: `member${index}@acme.test`,
    lastLegacyAuthenticationAtMs: null,
  };
}

function migrationScreen({
  migration = migrationWith(),
  connectionState = "ACTIVE",
  canManage = true,
}: {
  migration?: SelfServeMigrationView;
  connectionState?: SsoConnectionLifecycleState;
  canManage?: boolean;
} = {}) {
  return (
    <ChakraProvider value={defaultSystem}>
      <MigrationProgress
        organizationId="org_acme"
        canManage={canManage}
        migration={migration}
        connectionState={connectionState}
      />
    </ChakraProvider>
  );
}

beforeEach(() => {
  progressMock.mockReturnValue({
    data: null,
    error: null,
    isFetching: false,
    refetch: refetchMock,
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("given a replacement with a successful test sign-in", () => {
  describe("when normal sign-in is still using the legacy connection", () => {
    /** @scenario "Migration routing waits for the replacement to be active" */
    it("waits for activation before sending the route mutation", () => {
      const view = render(migrationScreen({ connectionState: "VERIFIED" }));

      const switchButton = screen.getByRole("button", {
        name: "Switch to new SSO",
      });
      expect(switchButton.hasAttribute("disabled")).toBe(true);
      fireEvent.click(switchButton);
      expect(routeMock).not.toHaveBeenCalled();

      view.rerender(migrationScreen());
      fireEvent.click(
        screen.getByRole("button", { name: "Switch to new SSO" }),
      );
      expect(routeMock).toHaveBeenCalledWith(
        {
          organizationId: "org_acme",
          connectionId: "ssoc_direct",
          route: "direct",
        },
        expect.any(Object),
      );
    });
  });

  describe("when finalization has started", () => {
    /** @scenario "Finalizing a migration closes its route controls" */
    it("offers only an eligible retry until finalization completes", () => {
      const migration = migrationWith({
        phase: "FINALIZING",
        selectedRoute: "direct",
        canFinalize: true,
      });
      const view = render(migrationScreen({ migration }));

      expect(screen.queryByRole("button", { name: /Roll back/ })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Switch to new SSO" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Retry finalization" }),
      );
      expect(finalizeMock).toHaveBeenCalledWith(
        { organizationId: "org_acme", connectionId: "ssoc_direct" },
        expect.any(Object),
      );

      view.rerender(
        migrationScreen({ migration: { ...migration, phase: "FINALIZED" } }),
      );
      expect(
        screen.queryByRole("button", {
          name: /finalization|Finalize|Roll back|Switch to/,
        }),
      ).toBeNull();
    });
  });

  describe("when the replacement is suspended", () => {
    /** @scenario "Migration routing waits for the replacement to be active" */
    it("keeps rollback and finalization unavailable", () => {
      render(
        migrationScreen({
          connectionState: "SUSPENDED",
          migration: migrationWith({
            phase: "GRACE_DIRECT",
            selectedRoute: "direct",
            canFinalize: true,
          }),
        }),
      );

      const rollback = screen.getByRole("button", { name: /Roll back/ });
      const finalize = screen.getByRole("button", {
        name: "Finalize migration",
      });
      expect(rollback.hasAttribute("disabled")).toBe(true);
      expect(finalize.hasAttribute("disabled")).toBe(true);
      fireEvent.click(rollback);
      fireEvent.click(finalize);
      expect(routeMock).not.toHaveBeenCalled();
      expect(finalizeMock).not.toHaveBeenCalled();
    });
  });

  describe("when a reader may not manage single sign-on", () => {
    /** @scenario "Reading migration progress does not grant permission to change it" */
    it("shows the remaining members without migration controls", () => {
      render(migrationScreen({ canManage: false }));

      expect(screen.getByText("Member 0")).toBeDefined();
      expect(
        screen.queryByRole("button", { name: /Finalize|Roll back|Switch to/ }),
      ).toBeNull();
    });
  });
});

describe("given more than one page of members still using the legacy provider", () => {
  const firstMembers: SelfServeMigrationView["members"] = {
    activeCount: 51,
    linkedCount: 0,
    stragglers: Array.from({ length: 25 }, (_, index) => person(index)),
    nextCursor: "user_024",
  };

  describe("when the administrator pages through the remaining members", () => {
    /** @scenario "Every member still using the old provider can be reached" */
    it("uses each returned cursor and allows returning to the first page", () => {
      progressMock.mockImplementation(
        ({ cursor }: { cursor: string | null }) => ({
          data: migrationWith({
            members: {
              ...firstMembers,
              stragglers:
                cursor === "user_024"
                  ? Array.from({ length: 25 }, (_, index) => person(index + 25))
                  : [person(50)],
              nextCursor: cursor === "user_024" ? "user_049" : null,
            },
          }),
          error: null,
          isFetching: false,
          refetch: refetchMock,
        }),
      );
      render(
        migrationScreen({
          migration: migrationWith({ members: firstMembers }),
        }),
      );

      expect(screen.getByText("Member 0")).toBeDefined();
      expect(screen.getByText("Member 24")).toBeDefined();
      expect(
        screen.queryByRole("button", { name: "Previous members" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Next members" }));

      expect(progressMock).toHaveBeenLastCalledWith(
        {
          organizationId: "org_acme",
          connectionId: "ssoc_direct",
          cursor: "user_024",
          limit: 25,
        },
        { enabled: true },
      );
      expect(screen.queryByText("Member 0")).toBeNull();
      expect(screen.getByText("Member 25")).toBeDefined();
      expect(screen.getByText("Member 49")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Next members" }));

      expect(progressMock).toHaveBeenLastCalledWith(
        {
          organizationId: "org_acme",
          connectionId: "ssoc_direct",
          cursor: "user_049",
          limit: 25,
        },
        { enabled: true },
      );
      expect(screen.getByText("Member 50")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Next members" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Previous members" }));
      expect(screen.getByText("Member 25")).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "Previous members" }));
      expect(screen.getByText("Member 0")).toBeDefined();
      expect(screen.queryByText("Member 25")).toBeNull();
    });
  });

  describe("when the next page cannot be read", () => {
    /** @scenario "A migration member page that failed can be retried" */
    it("reports the failure and permits retry or returning to the first page", () => {
      progressMock.mockReturnValue({
        data: null,
        error: new Error("temporary failure"),
        isFetching: false,
        refetch: refetchMock,
      });
      render(
        migrationScreen({
          migration: migrationWith({ members: firstMembers }),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Next members" }));

      expect(
        screen.getByText(
          /We could not load the members still using the previous provider/,
        ),
      ).toBeDefined();
      expect(screen.queryByText("Member 0")).toBeNull();
      expect(
        screen.queryByText("No remaining members on this page."),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Retry members" }));
      expect(refetchMock).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Previous members" }));
      expect(screen.getByText("Member 0")).toBeDefined();
    });
  });
});
