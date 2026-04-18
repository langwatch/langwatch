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

const { mutateSpy, toasterCreate, hardRedirectSpy, mockState } = vi.hoisted(
  () => {
    return {
      mutateSpy: vi.fn(),
      toasterCreate: vi.fn(),
      hardRedirectSpy: vi.fn(),
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
  },
);

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
      it("hard-redirects to / and reports 'already-accepted' status", async () => {
        mockState.mutation.isError = true;
        mockState.mutation.error = { message: INVITE_ALREADY_ACCEPTED_MESSAGE };

        const { result } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.handlers.onError?.({
            message: INVITE_ALREADY_ACCEPTED_MESSAGE,
          });
        });

        expect(hardRedirectSpy).toHaveBeenCalledWith("/");
        expect(result.current.status).toBe("already-accepted");
      });
    });
  });

  describe("given the server returns a generic error", () => {
    describe("when onError fires", () => {
      it("surfaces status='error' with the message and does NOT navigate", () => {
        mockState.mutation.isError = true;
        mockState.mutation.error = { message: "The invite has expired" };

        const { result } = renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.handlers.onError?.({ message: "The invite has expired" });
        });

        expect(hardRedirectSpy).not.toHaveBeenCalled();
        expect(result.current.status).toBe("error");
        expect(result.current.errorMessage).toBe("The invite has expired");
      });
    });
  });

  describe("given the mutation succeeds", () => {
    describe("when the invite has a landing project", () => {
      it("hard-redirects to the project slug and toasts success", () => {
        renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.handlers.onSuccess?.({
            invite: { organization: { name: "Acme" } },
            project: { slug: "acme-prod" },
          });
        });

        expect(hardRedirectSpy).toHaveBeenCalledWith("/acme-prod");
        expect(toasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "success" }),
        );
      });
    });

    describe("when the invite has no landing project", () => {
      it("hard-redirects to /", () => {
        renderHook(() =>
          useAcceptInviteOnce({
            inviteCode: "invite-abc",
            enabled: true,
          }),
        );

        act(() => {
          mockState.handlers.onSuccess?.({
            invite: { organization: { name: "Acme" } },
            project: null,
          });
        });

        expect(hardRedirectSpy).toHaveBeenCalledWith("/");
      });
    });
  });
});
