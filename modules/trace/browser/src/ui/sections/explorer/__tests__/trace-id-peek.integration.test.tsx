import {
  createUiScopeHost,
  UiScopeHostProvider,
} from "@langwatch/browser-host/use-organization-team-project";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceIdPeek, TracePreviewHoverCard } from "../trace-id-peek.tsx";

type HeaderInput = {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  tenantId?: string | null;
};

const { openDrawerMock, capturedHeaderInputs, useOrganizationTeamProjectMock } = vi.hoisted(() => ({
  openDrawerMock: vi.fn(),
  capturedHeaderInputs: [] as HeaderInput[],
  useOrganizationTeamProjectMock: vi.fn(() => ({ project: { id: "p1" } })),
}));

vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOrganizationTeamProject: useOrganizationTeamProjectMock,
}));

// The popover's body and its `traces.header` read live in `TracePeekSummary`.
// This file owns the partition-pruning hint, so capture what the hover hands
// the summary; that the summary forwards it to the header query is asserted
// beside the query.
vi.mock("../../trace-peek-summary.tsx", () => ({
  TracePeekSummary: (input: HeaderInput) => {
    capturedHeaderInputs.push(input);
    return null;
  },
}));

/**
 * The scope arrives from the shared host, not from a trace-only provider —
 * which is what lets this card render inside another family's screens.
 */
const scopeHost = createUiScopeHost({
  project: () => ({ id: "p1", name: "Checkout", slug: "checkout" }),
  organization: () => ({ id: "o1" }),
  team: () => ({ id: "t1" }),
  hasPermission: () => true,
});

const Wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">
    <UiScopeHostProvider value={scopeHost}>{children}</UiScopeHostProvider>
  </DesignSystemProvider>
);

/** A screen that mounts no scope host at all, as the simulations timeline did. */

const lastHeaderInput = (): HeaderInput => {
  const input = capturedHeaderInputs[capturedHeaderInputs.length - 1];
  if (!input) throw new Error("no header query input was captured");
  return input;
};

describe("TraceIdPeek", () => {
  beforeEach(() => {
    openDrawerMock.mockClear();
    useOrganizationTeamProjectMock.mockClear();
    capturedHeaderInputs.length = 0;
  });

  afterEach(() => cleanup());

  describe("given an occurredAtMs hint is supplied", () => {
    describe("when the eye icon is clicked", () => {
      it("forwards the hint to the drawer as the `t` partition param", async () => {
        render(<TraceIdPeek traceId="trace-1" occurredAtMs={1_700_000_000_000} />, {
          wrapper: Wrapper,
        });

        await userEvent.click(screen.getByRole("button"));

        expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-1",
          t: "1700000000000",
        });
      });
    });

    describe("when the trigger is hovered", () => {
      it("forwards the hint to the peek summary", async () => {
        render(<TraceIdPeek traceId="trace-1" occurredAtMs={1_700_000_000_000} />, {
          wrapper: Wrapper,
        });

        await userEvent.hover(screen.getByRole("button"));

        await waitFor(() =>
          expect(lastHeaderInput()).toMatchObject({
            traceId: "trace-1",
            occurredAtMs: 1_700_000_000_000,
          }),
        );
      });
    });
  });

  describe("given no occurredAtMs hint is supplied", () => {
    describe("when the eye icon is clicked", () => {
      it("opens the drawer by id only (unconstrained scan fallback)", async () => {
        render(<TraceIdPeek traceId="trace-1" />, { wrapper: Wrapper });

        await userEvent.click(screen.getByRole("button"));

        expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-1",
        });
      });
    });

    describe("when the trigger is hovered", () => {
      it("omits the occurredAtMs hint on the peek summary", async () => {
        render(<TraceIdPeek traceId="trace-1" />, { wrapper: Wrapper });

        await userEvent.hover(screen.getByRole("button"));

        await waitFor(() => expect(capturedHeaderInputs.length).toBeGreaterThan(0));
        expect(lastHeaderInput().occurredAtMs).toBeUndefined();
      });
    });
  });

  describe("given the row names no project that owns the trace", () => {
    it("renders without resolving the current project", () => {
      render(<TraceIdPeek traceId="trace-1" />, { wrapper: Wrapper });

      expect(useOrganizationTeamProjectMock).not.toHaveBeenCalled();
    });
  });

  describe("given the row names a member of the aggregate project as the owner", () => {
    describe("when the eye icon is clicked", () => {
      it("opens the drawer on that member", async () => {
        render(<TraceIdPeek traceId="trace-1" ownerProjectId="member-1" />, {
          wrapper: Wrapper,
        });

        await userEvent.click(screen.getByRole("button"));

        expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-1",
          tenantId: "member-1",
        });
      });
    });
  });

  describe("given the row names the current project as the owner", () => {
    describe("when the eye icon is clicked", () => {
      it("opens the drawer naming no member", async () => {
        render(<TraceIdPeek traceId="trace-1" ownerProjectId="p1" />, {
          wrapper: Wrapper,
        });

        await userEvent.click(screen.getByRole("button"));

        expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-1",
        });
      });
    });
  });
});

describe("TracePreviewHoverCard", () => {
  describe("when it is rendered by a family that mounts no scope host", () => {
    it("renders its trigger instead of taking the page down (D20)", () => {
      renderWithDesignSystem(
        <TracePreviewHoverCard traceId="trace-1">
          <span>turn separator</span>
        </TracePreviewHoverCard>,
      );

      expect(screen.getByText("turn separator")).toBeInTheDocument();
    });
  });
});
