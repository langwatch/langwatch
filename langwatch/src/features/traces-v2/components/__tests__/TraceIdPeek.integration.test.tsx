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

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      header: {
        // Capture the query input then keep the popover in its loading
        // state so we assert the forwarded hint without needing a full
        // trace payload to render the metrics body.
        useQuery: (input: HeaderInput) => {
          capturedHeaderInputs.push(input);
          return { data: undefined, isLoading: true };
        },
      },
    },
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
        render(
          <TraceIdPeek traceId="trace-1" occurredAtMs={1_700_000_000_000} />,
          { wrapper: Wrapper },
        );

        await userEvent.click(screen.getByRole("button"));

        expect(openDrawerMock).toHaveBeenCalledWith("traceV2Details", {
          traceId: "trace-1",
          t: "1700000000000",
        });
      });
    });

    describe("when the trigger is hovered", () => {
      it("forwards the hint to the peek summary fetch", async () => {
        render(
          <TraceIdPeek traceId="trace-1" occurredAtMs={1_700_000_000_000} />,
          { wrapper: Wrapper },
        );

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
      it("omits the occurredAtMs hint on the peek summary fetch", async () => {
        render(<TraceIdPeek traceId="trace-1" />, { wrapper: Wrapper });

        await userEvent.hover(screen.getByRole("button"));

        await waitFor(() =>
          expect(capturedHeaderInputs.length).toBeGreaterThan(0),
        );
        expect(lastHeaderInput().occurredAtMs).toBeUndefined();
      });
    });
  });
});
