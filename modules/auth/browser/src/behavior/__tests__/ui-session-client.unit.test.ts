/** The session read: BetterAuth's client, the impersonation-aware endpoint. */

import { describe, expect, it } from "vitest";

import { readUiActor, toUiActor, UI_SESSION_PATH, type UiAuthClient } from "../ui-session-client";

/**
 * An auth client that answers a read and refuses to end the session.
 */
const readingClient = ($fetch: UiAuthClient["$fetch"]): UiAuthClient => ({
  $fetch,
  signOut: () => {
    throw new Error("The session read ended the session.");
  },
});

describe("given a reply from the deployment's session endpoint", () => {
  describe("when it carries a user", () => {
    it("reads the reader out of it", () => {
      expect(
        toUiActor({
          session: { expiresAt: "2026-01-01T00:00:00.000Z" },
          user: { id: "user-jane", name: "Jane", email: "jane@example.com", image: null },
        }),
      ).toEqual({
        id: "user-jane",
        name: "Jane",
        email: "jane@example.com",
        image: null,
      });
    });

    it("reads a missing name, email or picture as absent rather than as a value", () => {
      expect(toUiActor({ user: { id: "user-jane" } })).toEqual({
        id: "user-jane",
        name: null,
        email: null,
        image: null,
      });
    });
  });

  describe("when it carries nobody", () => {
    it("reads null from every shape that names no user id", () => {
      expect(toUiActor(null)).toBeNull();
      expect(toUiActor({})).toBeNull();
      expect(toUiActor({ user: {} })).toBeNull();
      expect(toUiActor({ user: { id: 7 } })).toBeNull();
      expect(toUiActor("not a session")).toBeNull();
    });
  });
});

describe("given the client the session is read with", () => {
  describe("when the read is made", () => {
    it("asks the deployment's impersonation-aware endpoint, not the raw one", async () => {
      const asked: string[] = [];

      await readUiActor(
        readingClient((path: string) => {
          asked.push(path);
          return Promise.resolve({ data: { user: { id: "user-jane" } } });
        }),
      );

      expect(asked).toEqual(["/session"]);
      expect(UI_SESSION_PATH).toBe("/session");
    });
  });

  describe("when the endpoint refuses the read", () => {
    /** @scenario "A genuine refusal still goes to sign in" */
    it("reads nobody, and names the refusal rather than losing it", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 401, code: "unauthenticated" } })),
      );

      expect(reading.actor).toBeNull();
      expect(reading.unreachable).toBe(false);
      expect(reading.failure?.code).toBe("session_read_failed");
    });
  });

  describe("when nothing answered on the API's address", () => {
    /** @scenario "The API is not listening yet" */
    it("reads nobody and names no refusal when the read never reached the endpoint", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.reject(new Error("Failed to fetch"))),
      );

      expect(reading.actor).toBeNull();
      expect(reading.unreachable).toBe(true);
      expect(reading.failure).toBeNull();
    });

    /** @scenario "The API is not listening yet" */
    it("reads a proxy's own gateway refusal as nothing having answered", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 502 } })),
      );

      expect(reading.unreachable).toBe(true);
      expect(reading.failure).toBeNull();
    });
  });
});
