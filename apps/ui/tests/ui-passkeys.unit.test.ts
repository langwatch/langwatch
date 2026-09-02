/**
 * @vitest-environment jsdom
 *
 * The passkey ceremonies, and linking an additional sign-in method.
 *
 * THE WIRE, PINNED WHERE THE WIRE IS — the credentials family's lesson, second
 * application. `@langwatch/user-web` decides what the reader is TOLD about an
 * outcome and pins that in its own suite; this file decides what an outcome
 * MEANS, and the distinction it turns on is invisible from a render: better-auth
 * reports a device prompt the person dismissed as an error with STATUS ZERO,
 * and reading that as a failure is telling somebody off for a decision.
 *
 * `linkUiSignInMethod` is the one call here that is a plain REST request, and
 * its body is a compatibility surface with better-auth's own `/link-social`
 * route: the provider id is mapped and the callback is named `callbackURL`.
 *
 * Spec: specs/identity/passkeys.feature
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  linkUiSignInMethod,
  listUiPasskeys,
  readPasskeyOutcome,
  registerUiPasskey,
  removeUiPasskey,
  renameUiPasskey,
} from "../src/behavior/ui-passkeys";

type Answer = { data?: unknown; error?: { status?: number } | null } | undefined;

function client(answer: Answer | (() => never), list: Answer = { data: [] }) {
  const call = () => (typeof answer === "function" ? answer() : Promise.resolve(answer));
  return {
    passkey: {
      listUserPasskeys: () => Promise.resolve(list as { data?: unknown }),
      addPasskey: vi.fn(call),
      deletePasskey: vi.fn(call),
      updatePasskey: vi.fn(call),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given a ceremony result", () => {
  describe("when there was no error", () => {
    /** @scenario Registering a passkey from settings adds a way in */
    it("reads as done", () => {
      expect(readPasskeyOutcome({})).toEqual({ ok: true });
      expect(readPasskeyOutcome({ error: null })).toEqual({ ok: true });
      expect(readPasskeyOutcome(void 0)).toEqual({ ok: true });
    });
  });

  describe("when the error carries a zero status", () => {
    /**
     * THE READING THIS MODULE EXISTS FOR. There was no response because there
     * was no request: the person opened the operating system's dialog, looked
     * at it and closed it.
     */
    /** @scenario A dismissed device prompt is not reported as a failure */
    it("reads as a cancellation rather than a failure", () => {
      expect(readPasskeyOutcome({ error: { status: 0 } })).toEqual({
        ok: false,
        cancelled: true,
      });
    });
  });

  describe("when the error carries a real status", () => {
    /** @scenario A ceremony the device could not run says so */
    it("reads as a failure", () => {
      expect(readPasskeyOutcome({ error: { status: 400 } })).toEqual({
        ok: false,
        cancelled: false,
      });
      expect(readPasskeyOutcome({ error: {} })).toEqual({ ok: false, cancelled: false });
    });
  });
});

describe("given a device that cannot run the ceremony at all", () => {
  describe("when the client throws", () => {
    /**
     * A throw is never a cancellation: no authenticator, an insecure context or
     * a browser without WebAuthn are none of them a decision the person made,
     * so the reader is told rather than left with a button that did nothing.
     */
    /** @scenario A ceremony the device could not run says so */
    it("reads as a failure and not as a dismissal", async () => {
      const throwing = client(() => {
        throw new Error("no authenticator");
      });

      await expect(registerUiPasskey(throwing)).resolves.toEqual({
        ok: false,
        cancelled: false,
      });
      await expect(removeUiPasskey({ id: "p1" }, throwing)).resolves.toEqual({
        ok: false,
        cancelled: false,
      });
      await expect(renameUiPasskey({ id: "p1", name: "Laptop" }, throwing)).resolves.toEqual({
        ok: false,
        cancelled: false,
      });
    });
  });
});

describe("given the passkeys an account holds", () => {
  describe("when the list is read", () => {
    /** @scenario A passkey is named, and the name can be changed */
    it("hands back the rows", async () => {
      const rows = [{ id: "p1", name: "Laptop", createdAt: "2026-01-01T00:00:00.000Z" }];

      await expect(listUiPasskeys(client({}, { data: rows }))).resolves.toEqual(rows);
    });

    /** @scenario A passkey is named, and the name can be changed */
    it("answers an empty list when the endpoint answered with no array", async () => {
      await expect(listUiPasskeys(client({}, { data: null }))).resolves.toEqual([]);
      await expect(listUiPasskeys(client({}, void 0))).resolves.toEqual([]);
    });
  });
});

describe("given a rename and a removal", () => {
  describe("when they are sent", () => {
    /** @scenario A passkey is named, and the name can be changed */
    it("names the passkey the reader picked", async () => {
      const passkeys = client({});

      await renameUiPasskey({ id: "p1", name: "Work laptop" }, passkeys);
      await removeUiPasskey({ id: "p2" }, passkeys);

      expect(passkeys.passkey.updatePasskey).toHaveBeenCalledWith({
        id: "p1",
        name: "Work laptop",
      });
      expect(passkeys.passkey.deletePasskey).toHaveBeenCalledWith({ id: "p2" });
    });
  });
});

describe("given a reader linking an additional sign-in method", () => {
  function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return Promise.resolve(response as Response);
      }),
    );
    return calls;
  }

  describe("when the provider is one the product names differently", () => {
    /**
     * `azure-ad` is what `NEXTAUTH_PROVIDER` is set to; `microsoft` is what
     * better-auth's social plugin registers. The mapping belongs on this side
     * of the seam — a screen that knew about it would be encoding a library's
     * naming.
     */
    /** @scenario Linking an additional sign-in method goes through the account-linking route */
    it("sends better-auth's own provider id", async () => {
      const calls = stubFetch({ ok: true, json: () => Promise.resolve({ redirect: false }) });

      await linkUiSignInMethod("azure-ad", { callbackUrl: "/settings/authentication" });

      expect(calls[0]?.[0]).toBe("/api/auth/link-social");
      expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
        provider: "microsoft",
        callbackURL: "/settings/authentication",
      });
    });

    /** @scenario Linking an additional sign-in method goes through the account-linking route */
    it("leaves every other provider id alone", async () => {
      const calls = stubFetch({ ok: true, json: () => Promise.resolve({ redirect: false }) });

      await linkUiSignInMethod("github", { callbackUrl: "/settings/authentication" });

      expect(JSON.parse(String(calls[0]?.[1]?.body)).provider).toBe("github");
    });

    /**
     * `/link-social` rather than a sign-in is the whole point: better-auth
     * enforces same-email matching on it, so linking cannot become the "sign in
     * while already signed in and silently switch accounts" regression.
     */
    /** @scenario Linking an additional sign-in method goes through the account-linking route */
    it("sends the session cookie, because linking is done as the signed-in reader", async () => {
      const calls = stubFetch({ ok: true, json: () => Promise.resolve({ redirect: false }) });

      await linkUiSignInMethod("github", { callbackUrl: "/settings/authentication" });

      expect(calls[0]?.[1]?.credentials).toBe("include");
    });
  });

  describe("when the provider refuses", () => {
    /** @scenario Linking an additional sign-in method goes through the account-linking route */
    it("hands back the reason rather than throwing", async () => {
      stubFetch({ ok: false, text: () => Promise.resolve("account already linked") });

      await expect(
        linkUiSignInMethod("github", { callbackUrl: "/settings/authentication" }),
      ).resolves.toEqual({ ok: false, reason: "account already linked" });
    });
  });
});
