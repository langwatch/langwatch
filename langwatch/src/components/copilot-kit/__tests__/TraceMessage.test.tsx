/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceMessage } from "../TraceMessage";

const useGetByIdQueryMock = vi.fn();

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    traces: {
      getById: {
        useQuery: (...args: unknown[]) => useGetByIdQueryMock(...args),
      },
    },
  },
}));

// Only rendered on the success path (not reached here); mocked so the
// traces-v2 module graph does not have to load for this test.
vi.mock("~/features/traces-v2/components/TraceIdPeek", () => ({
  TracePreviewHoverCard: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("~/hooks/useTraceDetailsDrawer", () => ({
  useTraceDetailsDrawer: () => ({ openTraceDetailsDrawer: vi.fn() }),
}));

describe("TraceMessage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given a prompt conversation references a trace that no longer exists", () => {
    describe("when the trace query returns a 404", () => {
      /** @scenario A prompt with a running conversation re-opens without crashing */
      it("renders nothing instead of throwing", () => {
        // A "View Trace" link is attached to each assistant turn. When that
        // turn's trace cannot be fetched (it was never written, or expired),
        // the link must degrade to an empty render, never throw to the page
        // error boundary, so re-opening a prompt with an old conversation does
        // not crash the playground. TraceMessage returns null while loading, on
        // error, or with no data; here the query is in the 404 error state.
        useGetByIdQueryMock.mockReturnValue({
          isLoading: false,
          isError: true,
          data: undefined,
        });

        const { container } = render(
          <TraceMessage traceId="ff364975e79bc3c1ad48c38024928fea" />,
        );

        expect(container.firstChild).toBeNull();
      });
    });
  });
});
