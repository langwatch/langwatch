/**
 * The session read, and the one deployment fact the scope rules need from the
 * HTML shell.
 *
 * A payload without a user id is signed out, not a broken user: the endpoint
 * answers `null` for a reader with no session, and a half-shaped user is a
 * reply nothing can act on either way. Reading it as a user would show a
 * signed-out visitor as signed in.
 */

import { describe, expect, it } from "vitest";
import { createPublicAppConfigMetaTag } from "@langwatch/config/public-app-config";
import { readUiDemoProjectSlug } from "../src/behavior/ui-session";
import { readUiActor, toUiActor, UI_SESSION_PATH } from "../src/behavior/ui-session-client";

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

      await readUiActor({
        $fetch: (path: string) => {
          asked.push(path);
          return Promise.resolve({ data: { user: { id: "user-jane" } } });
        },
      });

      expect(asked).toEqual(["/session"]);
      expect(UI_SESSION_PATH).toBe("/session");
    });
  });

  describe("when the endpoint refuses the read", () => {
    it("fails rather than reporting the reader as signed out", async () => {
      await expect(
        readUiActor({ $fetch: () => Promise.resolve({ error: { status: 500 } }) }),
      ).rejects.toThrow(/session endpoint refused/);
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
