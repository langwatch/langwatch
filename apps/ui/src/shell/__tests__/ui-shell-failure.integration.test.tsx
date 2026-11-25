// @vitest-environment jsdom
/**
 * A shell host whose organization graph refused: sign in when nobody is known,
 * otherwise the registered copy and the trace id, never a blank page.
 * @see specs/auth/session-failure.feature
 */
import * as navigation from "@langwatch/browser-host/navigation";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUiShellFailure } from "../ui-shell-failure.ts";

vi.mock("@langwatch/browser-host/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof navigation>()),
  uiLeaveTo: vi.fn(),
}));

const SIGN_IN = "/auth/signin";

function shellFailure({ error, address }: { error: unknown; address: string }) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [address] }, children);

  return renderHook(
    () =>
      useUiShellFailure({
        error,
        fallbackTitle: "Couldn't open the workspace",
        isPublicRoute: false,
        signInPath: SIGN_IN,
      }),
    { wrapper },
  );
}

afterEach(() => {
  vi.mocked(navigation.uiLeaveTo).mockClear();
});

describe("given the organization graph refused inside the shell", () => {
  describe("when the caller is not authenticated", () => {
    /** @scenario A refused organization graph sends an unauthenticated reader to sign in */
    it("leaves for sign-in carrying the asked address, and draws nothing over the page", () => {
      const unauthenticated = { data: { httpStatus: 401, code: "UNAUTHORIZED" } };

      const { result } = shellFailure({ error: unauthenticated, address: "/acme/traces?tab=1" });

      expect(result.current).toEqual({ departing: true, copy: null });
      expect(navigation.uiLeaveTo).toHaveBeenCalledWith(
        `${SIGN_IN}?callbackUrl=${encodeURIComponent("/acme/traces?tab=1")}`,
      );
    });
  });

  describe("when the refusal is a named failure the reader can act on", () => {
    /** @scenario A refused organization graph renders its handled failure, never a blank page */
    it("answers its copy with the trace id and sends the reader nowhere", () => {
      const named = { code: "something_went_wrong", httpStatus: 500, traceId: "trace-abc" };

      const { result } = shellFailure({ error: named, address: "/acme/traces" });

      expect(result.current.departing).toBe(false);
      expect(result.current.copy).toMatchObject({ traceId: "trace-abc" });
      expect(result.current.copy?.title).toBeTruthy();
      expect(navigation.uiLeaveTo).not.toHaveBeenCalled();
    });
  });
});
