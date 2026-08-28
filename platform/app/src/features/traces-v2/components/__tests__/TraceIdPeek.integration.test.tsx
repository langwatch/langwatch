/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceIdPeek } from "../TraceIdPeek";

type HeaderInput = {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
};

const { openDrawerMock, capturedHeaderInputs } = vi.hoisted(() => ({
  openDrawerMock: vi.fn(),
  capturedHeaderInputs: [] as HeaderInput[],
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: openDrawerMock }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

// The popover's body and its `tracesV2.header` read now live in
// `@langwatch/trace-web` as `TracePeekSummary`. This file still owns the
// partition-pruning hint, so capture what the hover hands the summary; that the
// summary forwards it to the header query is asserted in the package, beside
// the query.
vi.mock("@langwatch/trace-web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/trace-web")>()),
  TracePeekSummary: (input: HeaderInput) => {
    capturedHeaderInputs.push(input);
    return null;
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const lastHeaderInput = (): HeaderInput => {
  const input = capturedHeaderInputs[capturedHeaderInputs.length - 1];
  if (!input) throw new Error("no header query input was captured");
  return input;
};

describe("TraceIdPeek", () => {
  beforeEach(() => {
    openDrawerMock.mockClear();
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
});
