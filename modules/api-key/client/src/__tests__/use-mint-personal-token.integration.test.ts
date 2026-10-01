/**
 * @vitest-environment jsdom
 *
 * The setup screens' minted token: ingestion-only, held in memory for one scope.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROJECT_READ_PERMISSIONS } from "../personal-token-scope.ts";
import { useMintPersonalToken } from "../use-mint-personal-token.ts";

const mints = vi.hoisted(() => ({
  calls: [] as {
    input: Record<string, unknown>;
    resolve: (answer: { token: string }) => void;
    reject: (error: Error) => void;
  }[],
}));

vi.mock("../api-key-client.ts", () => ({
  apiKeyClient: {
    apiKey: {
      create: {
        useMutation: () => ({
          mutateAsync: (input: Record<string, unknown>) =>
            new Promise<{ token: string }>((resolve, reject) =>
              mints.calls.push({ input, resolve, reject }),
            ),
          reset: () => {},
        }),
      },
    },
  },
}));

afterEach(() => {
  cleanup();
  mints.calls.length = 0;
});

type MintArgs = Parameters<typeof useMintPersonalToken>[0];

const ALPHA: MintArgs = {
  organizationId: "org-1",
  projectId: "alpha",
  userId: "ada",
  name: "Token",
};

function renderMint(scope: MintArgs = ALPHA) {
  return renderHook((props: MintArgs) => useMintPersonalToken(props), { initialProps: scope });
}

async function answer(index: number, token: string) {
  await act(async () => {
    mints.calls[index]?.resolve({ token });
  });
}

describe("useMintPersonalToken", () => {
  describe("when a token is minted", () => {
    /** @scenario Integrating a project offers a personal access token, shown once */
    it("mints an ingestion-only key on the project, expiring in 90 days, and holds its token", async () => {
      const { result } = renderMint();

      act(() => void result.current.mint());
      expect(result.current.isMinting).toBe(true);
      await answer(0, "sk-lw-alpha");

      expect(mints.calls[0]?.input).toMatchObject({
        organizationId: "org-1",
        keyType: "personal",
        permissionMode: "restricted",
        permissions: ["traces:create"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "alpha" }],
      });
      const days = (Date.parse(String(mints.calls[0]?.input.expiresAt)) - Date.now()) / 86_400_000;
      expect(Math.round(days)).toBe(90);
      expect(result.current.token).toBe("sk-lw-alpha");
      expect(result.current.isMinting).toBe(false);
      expect(result.current.scopeNote).toBe(
        "This token can only send data to this project. It can't read or change anything.",
      );
    });

    it("mints only the permissions a snippet asks for, and says so", async () => {
      const { result } = renderMint({ ...ALPHA, permissions: ["prompts:view"] });

      act(() => void result.current.mint());
      await answer(0, "sk-lw-prompt");

      expect(mints.calls[0]?.input).toMatchObject({
        permissionMode: "restricted",
        permissions: ["prompts:view"],
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "alpha" }],
      });
      expect(result.current.scopeNote).toBe(
        "This token can read prompts in this project and nothing else.",
      );
    });
  });

  describe("when a coding-agent setup mints the MCP config's token", () => {
    it("holds project reads only, sends and changes nothing, and says so", async () => {
      const { result } = renderMint({ ...ALPHA, permissions: PROJECT_READ_PERMISSIONS });

      act(() => void result.current.mint());
      await answer(0, "sk-lw-mcp");

      expect(mints.calls[0]?.input).toMatchObject({
        permissionMode: "restricted",
        bindings: [{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "alpha" }],
      });
      expect(mints.calls[0]?.input.bindings).toHaveLength(1);
      expect(mints.calls[0]?.input.permissions).toEqual([
        "traces:view",
        "analytics:view",
        "prompts:view",
        "scenarios:view",
        "evaluations:view",
        "datasets:view",
        "experiments:view",
        "workflows:view",
        "annotations:view",
        "triggers:view",
        "project:view",
      ]);
      expect(result.current.scopeNote).toBe(
        "This token can read this project's data. It can't send or change anything.",
      );
    });
  });

  describe("when the server refuses the mint", () => {
    /** @scenario A token holding more than the reader may grant is refused */
    it("rejects with the refusal and holds no token", async () => {
      const { result } = renderMint();
      let minted: Promise<string | undefined> = Promise.resolve(undefined);
      act(() => {
        minted = result.current.mint();
      });
      const refusal = new Error("api_key_scope_violation");
      await act(async () => {
        mints.calls[0]?.reject(refusal);
        await minted.catch(() => undefined);
      });

      await expect(minted).rejects.toBe(refusal);
      expect(result.current.token).toBeUndefined();
      expect(result.current.isMinting).toBe(false);
    });
  });

  describe("when the project, organisation or user changes", () => {
    /** @scenario Manual setup drops a token when the signed-in user changes */
    it.each([
      ["project", { projectId: "beta" }],
      ["organisation", { organizationId: "org-2" }],
      ["user", { userId: "max" }],
    ])("drops the token when the %s changes", async (_label, change) => {
      const { result, rerender } = renderMint();
      act(() => void result.current.mint());
      await answer(0, "sk-lw-alpha");

      rerender({ ...ALPHA, ...change });
      expect(result.current.token).toBeUndefined();

      rerender(ALPHA);
      expect(result.current.token).toBeUndefined();
    });

    /** @scenario Manual setup drops a token whose mint finishes after the user changed */
    it("drops a mint that completes after the change", async () => {
      const { result, rerender } = renderMint();
      let minted: Promise<string | undefined> = Promise.resolve(undefined);
      act(() => {
        minted = result.current.mint();
      });

      rerender({ ...ALPHA, userId: "max" });
      await answer(0, "sk-lw-alpha");

      expect(await minted).toBeUndefined();
      expect(result.current.token).toBeUndefined();
    });
  });

  describe("when a second mint is asked for while one is in flight", () => {
    it("sends one request and both callers get its token", async () => {
      const { result } = renderMint();
      const minted: Promise<string | undefined>[] = [];
      act(() => {
        minted.push(result.current.mint(), result.current.mint());
      });
      await answer(0, "sk-lw-alpha");

      expect(mints.calls).toHaveLength(1);
      expect(await Promise.all(minted)).toEqual(["sk-lw-alpha", "sk-lw-alpha"]);
    });
  });
});
