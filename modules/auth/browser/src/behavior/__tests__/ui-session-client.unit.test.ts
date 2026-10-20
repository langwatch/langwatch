/** The session read: BetterAuth's client, the impersonation-aware endpoint. */

import type { UiAuthClient } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import {
  keepAnsweredReaderOnFailedReread,
  readUiActor,
  toUiActor,
  UI_SESSION_PATH,
} from "../ui-session-client";

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

  describe("when the answer carries the reader's sealing keys", () => {
    it("holds this epoch's key and the last beside the reader", async () => {
      const reading = await readUiActor(
        readingClient(() =>
          Promise.resolve({
            data: { user: { id: "user-jane" }, cacheKey: "k2", previousCacheKey: "k1" },
          }),
        ),
      );

      expect(reading.cacheKey).toBe("k2");
      expect(reading.previousCacheKey).toBe("k1");
    });

    it("holds no key when the answer named none", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ data: { user: { id: "user-jane" } } })),
      );

      expect(reading.cacheKey).toBeNull();
      expect(reading.previousCacheKey).toBeNull();
    });
  });

  describe("when the endpoint answers 401", () => {
    /** @scenario "A session endpoint answering 401 means nobody is signed in" */
    it("reads nobody, as an answer rather than a wait", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 401, code: "unauthenticated" } })),
      );

      expect(reading.actor).toBeNull();
      expect(reading.unreachable).toBe(false);
    });
  });

  describe("when nothing answered who is here", () => {
    /** @scenario "The API is not listening yet" */
    it("reads unreachable when the read never reached the endpoint", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.reject(new Error("Failed to fetch"))),
      );

      expect(reading.actor).toBeNull();
      expect(reading.unreachable).toBe(true);
    });

    /** @scenario "The API is not listening yet" */
    it("reads a proxy's own gateway refusal as nothing having answered", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 502 } })),
      );

      expect(reading.unreachable).toBe(true);
    });

    /** @scenario "A failed session read is not read as signed out" */
    it("reads a proxy's 4xx that names no session as nothing having answered", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 400, code: "bad_request" } })),
      );

      expect(reading.actor).toBeNull();
      expect(reading.unreachable).toBe(true);
    });
  });
});

describe("given an impersonated session", () => {
  it("carries the operator acting as the user", () => {
    expect(
      toUiActor({
        user: {
          id: "user-jane",
          email: "jane@example.com",
          impersonator: { id: "op-1", email: "op@example.com", name: "Op" },
        },
      })?.impersonator,
    ).toEqual({ id: "op-1", email: "op@example.com" });
  });

  it("carries no operator for a normal session", () => {
    expect(toUiActor({ user: { id: "user-jane" } })?.impersonator).toBeUndefined();
  });
});

describe("given the session already answered who is here", () => {
  const answered = {
    actor: { id: "user-jane", name: "Jane", email: null, image: null },
    unreachable: false,
    cacheKey: "key",
    previousCacheKey: null,
  };

  describe("when a re-read fails", () => {
    /** @scenario "A failed re-read keeps the reader who was already signed in" */
    it("keeps the reader who was already signed in", async () => {
      const failed = await readUiActor(
        readingClient(() => Promise.resolve({ data: null, error: { status: 400, code: "x" } })),
      );

      expect(failed.unreachable).toBe(true);
      expect(keepAnsweredReaderOnFailedReread({ reading: failed, previous: answered })).toBe(
        answered,
      );
    });
  });

  describe("when the re-read answers that nobody is signed in", () => {
    /** @scenario "A failed re-read keeps the reader who was already signed in" */
    it("takes the new answer", async () => {
      const signedOut = await readUiActor(
        readingClient(() => Promise.resolve({ data: null, error: null })),
      );

      expect(keepAnsweredReaderOnFailedReread({ reading: signedOut, previous: answered })).toBe(
        signedOut,
      );
    });
  });

  describe("when a first read fails", () => {
    /** @scenario "A failed re-read keeps the reader who was already signed in" */
    it("holds it as unanswered, never as signed out", async () => {
      const failed = await readUiActor(
        readingClient(() => Promise.resolve({ data: null, error: { status: 400, code: "x" } })),
      );

      expect(keepAnsweredReaderOnFailedReread({ reading: failed, previous: undefined })).toBe(
        failed,
      );
    });
  });
});
