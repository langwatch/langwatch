// @vitest-environment jsdom
/**
 * A run whose access is still being set up is resent every 5 s, twelve times, then errors.
 * @see modules/workflow/specs/studio-connection-status.feature
 */
import type * as Errors from "@langwatch/browser-host/errors";
import type * as FetchSse from "@langwatch/browser-host/fetch-sse";
import { FetchSSERefusedError, type FetchSSEOptions } from "@langwatch/browser-host/fetch-sse";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePostEvent } from "../use-post-event.tsx";

const { fetchSSE, showErrorToast, scope } = vi.hoisted(() => ({
  fetchSSE: vi.fn<(options: FetchSSEOptions<unknown>) => Promise<void>>(),
  showErrorToast: vi.fn(),
  scope: { project: { id: "project-1" } },
}));

vi.mock("@langwatch/browser-host/fetch-sse", async (importOriginal) => ({
  ...(await importOriginal<typeof FetchSse>()),
  fetchSSE,
}));
vi.mock("@langwatch/browser-host/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof Errors>()),
  showErrorToast,
}));
vi.mock("../../../../behavior/studio-host/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => scope,
}));

const heartbeat: StudioClientEvent = { type: "is_alive", payload: {} };
const run: StudioClientEvent = { type: "stop_execution", payload: { trace_id: "trace-1" } };

function pendingAccess(): FetchSSERefusedError {
  return new FetchSSERefusedError({
    message: "Your access change is still processing.",
    httpStatus: 503,
    body: { code: "authz_grant_not_confirmed", retryable: true },
  });
}

/** Every send is refused as pending: the hook's own onError hears it. */
function refuseEverySend() {
  fetchSSE.mockImplementation(async (options) => {
    options.onError?.(pendingAccess());
  });
}

describe("usePostEvent when the run's access is still being set up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchSSE.mockReset();
    showErrorToast.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The studio resends a run whose access is still being set up" */
  it("sends the same event again every 5 seconds without showing an error", async () => {
    refuseEverySend();
    const { result } = renderHook(() => usePostEvent());

    act(() => result.current.postEvent(run));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchSSE).toHaveBeenCalledTimes(2);
    expect(fetchSSE.mock.calls[1]?.[0].payload).toEqual({ projectId: "project-1", event: run });
    expect(showErrorToast).not.toHaveBeenCalled();
  });

  /** @scenario "The studio stops resending after a minute and shows the error" */
  it("stops after twelve resends and falls through to the error toast", async () => {
    refuseEverySend();
    const { result } = renderHook(() => usePostEvent());

    act(() => result.current.postEvent(run));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000 * 20);
    });

    expect(fetchSSE).toHaveBeenCalledTimes(13);
    expect(showErrorToast).toHaveBeenCalledTimes(1);
  });

  it("never resends the heartbeat", async () => {
    refuseEverySend();
    const { result } = renderHook(() => usePostEvent());

    act(() => result.current.postEvent(heartbeat));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fetchSSE).toHaveBeenCalledTimes(1);
    expect(showErrorToast).not.toHaveBeenCalled();
  });
});
