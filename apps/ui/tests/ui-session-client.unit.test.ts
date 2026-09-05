/**
 * The session read, and the one deployment fact the scope rules need from the HTML
 * shell.
 */

import { describe, expect, it } from "vitest";
import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { readUiDemoProjectSlug } from "../src/behavior/ui-session";
import {
  readUiActor,
  toUiActor,
  UI_SESSION_PATH,
  type UiAuthClient,
} from "../src/behavior/ui-session-client";

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
    it("reads nobody, and names the refusal rather than losing it", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.resolve({ error: { status: 500 } })),
      );

      expect(reading.actor).toBeNull();
      expect(reading.failure?.code).toBe("session_read_failed");
    });

    it("reads nobody when the read never reached the endpoint at all", async () => {
      const reading = await readUiActor(
        readingClient(() => Promise.reject(new Error("Failed to fetch"))),
      );

      expect(reading.actor).toBeNull();
      expect(reading.failure?.code).toBe("session_read_failed");
    });
  });
});

describe("given the deployment's demo project slug", () => {
  describe("when the HTML shell declares one", () => {
    it("reads it out of the shell", () => {
      const meta = createPublicAppConfigMetaTag({
        appBaseUrl: "https://app.example.com",
        gatewayBaseUrl: "https://gateway.example.com",
        deployment: "saas",
        demoProjectSlug: "demo-project",
        mode: "test",
        telemetry: { browserTracing: false, sampleRatio: 0 },
        capabilities: { email: false, nlp: false, langevals: false },
        passkeys: false,
        identityFrontDoor: false,
      });
      const documentRoot = {
        querySelector: () => ({
          getAttribute: () => /content="([^"]+)"/.exec(meta)?.[1] ?? null,
        }),
      };

      expect(readUiDemoProjectSlug(documentRoot)).toBe("demo-project");
    });
  });

  describe("when the shell declares none", () => {
    it("reads no demo project rather than failing the whole session", () => {
      expect(readUiDemoProjectSlug({ querySelector: () => null })).toBeUndefined();
    });
  });
});
