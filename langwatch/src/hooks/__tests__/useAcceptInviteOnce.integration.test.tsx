/**
 * @vitest-environment jsdom
 *
 * @regression @integration
 *
 * Regression coverage for langwatch/langwatch#3324:
 *   - `useAcceptInviteOnce` must call `mutate` at most once per invite code,
 *     even under StrictMode double-invoke / remount.
 *   - An "Invite was already accepted" error must redirect home via a hard
 *     navigation (never during render) so the React "update during render"
 *     warning cannot fire from a downstream consumer.
 *   - A generic error must surface via `status: "error"` + `errorMessage` and
 *     must NOT trigger any navigation.
 */
import "@testing-library/jest-dom/vitest";

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INVITE_ALREADY_ACCEPTED_MESSAGE } from "~/server/invites/errors";

const {
  mutateSpy,
  toasterCreate,
  hardRedirectSpy,
  captureExceptionSpy,
  mockState,
} = vi.hoisted(() => {
  return {
    mutateSpy: vi.fn(),
    toasterCreate: vi.fn(),
    hardRedirectSpy: vi.fn(),
    captureExceptionSpy: vi.fn(),
    mockState: {
      handlers: {} as {
        onSuccess?: (data: unknown) => void;
        onError?: (error: { message: string }) => void;
      },
      mutation: {
        isLoading: false,
        isSuccess: false,
        isError: false,
        error: null as { message: string } | null,
      },
    },
  };
});

vi.mock("~/utils/api", () => ({
  api: {
    organization: {
      acceptInvite: {
        useMutation: (handlers: typeof mockState.handlers) => {
          mockState.handlers = handlers;
          return {
            mutate: mutateSpy,
            ...mockState.mutation,
          };
        },
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: toasterCreate },
}));

vi.mock("~/utils/hardRedirect", () => ({
  hardRedirect: hardRedirectSpy,
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: captureExceptionSpy,
}));

import { useAcceptInviteOnce } from "../useAcceptInviteOnce";

function resetMutationState() {
  mockState.mutation = {
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
  };
  mockState.handlers = {};
}

describe("useAcceptInviteOnce()", () => {
  beforeEach(() => {
    mutateSpy.mockReset();
    toasterCreate.mockReset();
    hardRedirectSpy.mockReset();
    captureExceptionSpy.mockReset();
    resetMutationState();
  });

  afterEach(() => {
    cleanup();
  });

  describe("given an invite code and a signed-in session", () => {
    describe("when the component mounts under StrictMode", () => {
      it("calls mutate exactly once", () => {
        renderHook(
          () =>
            useAcceptInviteOnce({
              inviteCode: "invite-abc",
              enabled: true,
            }),
          { wrapper: StrictMode },
        );

        expect(mutateSpy).toHaveBeenCalledTimes(1);
        expect(mutateSpy).toHaveBeenCalledWith({ inviteCode: "invite-abc" });
      });

      it("does not re-submit when the hook re-renders with the same code", () => {
        const { rerender } = renderHook(
          ({ code }) =>
            useAcceptInviteOnce({
              inviteCode: code,
              enabled: true,
            }),
          {
            wrapper: StrictMode,
            initialProps: { code: "invite-abc" },
          },
        );

        rerender({ code: "invite-abc" });
        rerender({ code: "invite-abc" });

        expect(mutateSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the session is not yet available", () => {
    describe("when the hook renders with enabled=false", () => {
      it("does not call mutate and reports idle status", () => {
        const { result } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: false,
          }),
        );

        expect(mutateSpy).not.toHaveBeenCalled();
        expect(result.current.status).toBe("idle");
      });
    });
  });

  describe("given the server returns 'already accepted'", () => {
    describe("when onError fires", () => {
      it("hard-redirects to /, reports 'already-accepted' status, and does NOT capture to PostHog", () => {
        const { result, rerender } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.mutation.isError = true;
          mockState.mutation.error = {
            message: INVITE_ALREADY_ACCEPTED_MESSAGE,
          };
          mockState.handlers.onError?.({
            message: INVITE_ALREADY_ACCEPTED_MESSAGE,
          });
        });
        rerender();

        expect(hardRedirectSpy).toHaveBeenCalledWith("/");
        expect(captureExceptionSpy).not.toHaveBeenCalled();
        expect(result.current.status).toBe("already-accepted");
      });
    });
  });

  describe("given the server returns a generic error", () => {
    describe("when onError fires", () => {
      it("surfaces status='error' with the message, captures to PostHog, and does NOT navigate", () => {
        const { result, rerender } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.mutation.isError = true;
          mockState.mutation.error = { message: "The invite has expired" };
          mockState.handlers.onError?.({ message: "The invite has expired" });
        });
        rerender();

        expect(hardRedirectSpy).not.toHaveBeenCalled();
        expect(captureExceptionSpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: "The invite has expired" }),
          expect.objectContaining({
            tags: expect.objectContaining({ source: "useAcceptInviteOnce" }),
          }),
        );
        expect(result.current.status).toBe("error");
        expect(result.current.errorMessage).toBe("The invite has expired");
      });
    });
  });

  describe("given the mutation succeeds", () => {
    describe("when the invite has a landing project", () => {
      it("hard-redirects to the project slug, toasts success, and reports 'success' status", () => {
        const { result, rerender } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.mutation.isSuccess = true;
          mockState.handlers.onSuccess?.({
            invite: { organization: { name: "Acme" } },
            project: { slug: "acme-prod" },
          });
        });
        rerender();

        expect(hardRedirectSpy).toHaveBeenCalledWith("/acme-prod");
        expect(toasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        );
        expect(result.current.status).toBe("success");
      });
    });

    describe("when the invite has no landing project", () => {
      it("hard-redirects to / and reports 'success' status", () => {
        const { result, rerender } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.mutation.isSuccess = true;
          mockState.handlers.onSuccess?.({
            invite: { organization: { name: "Acme" } },
            project: null,
          });
        });
        rerender();

        expect(result.current.status).toBe("success");

        expect(hardRedirectSpy).toHaveBeenCalledWith("/");
      });
    });
  });
});
