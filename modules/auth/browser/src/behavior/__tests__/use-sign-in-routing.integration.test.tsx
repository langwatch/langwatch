/**
 * @vitest-environment jsdom
 */
import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface PendingRequest {
  input: { identifier: string | null };
  resolve: (decision: unknown) => void;
}

const { pending } = vi.hoisted(() => ({ pending: [] as PendingRequest[] }));

vi.mock("../auth-api.ts", () => ({
  authApi: {
    auth: {
      route: {
        useMutation: () => ({
          mutateAsync: (input: { identifier: string | null }) =>
            new Promise((resolve) => pending.push({ input, resolve })),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

import { useSignInRouting } from "../use-sign-in-routing.ts";

describe("useSignInRouting", () => {
  describe("when an earlier routing request answers after a later one", () => {
    let hook: RenderHookResult<ReturnType<typeof useSignInRouting>, unknown>;
    let methodsAnswer: Promise<unknown>;
    let addressAnswer: Promise<unknown>;

    beforeEach(async () => {
      pending.length = 0;
      hook = renderHook(() => useSignInRouting());
      act(() => {
        methodsAnswer = hook.result.current.decide({ identifier: null });
        addressAnswer = hook.result.current.decide({ identifier: "ada@acme.test" });
      });
      const [methodsRequest, addressRequest] = pending;
      await act(async () => {
        addressRequest!.resolve({ kind: "redirect", for: "ada@acme.test" });
        await addressAnswer;
      });
      await act(async () => {
        methodsRequest!.resolve({ kind: "methods" });
        await methodsAnswer;
      });
    });

    /** @scenario "A late instance-methods answer does not undo the carried address routing" */
    it("keeps the decision of the latest request", () => {
      expect(hook.result.current.identifier).toBe("ada@acme.test");
      expect(hook.result.current.decision).toEqual({ kind: "redirect", for: "ada@acme.test" });
    });

    it("still hands the stale answer back to its own caller", async () => {
      await expect(methodsAnswer).resolves.toEqual({ kind: "methods" });
    });
  });
});
