/**
 * The one API door: exactly one installed module binds it, and the process opens that one.
 * @see packages/api/specs/api-door.feature
 */
import { describe, expect, it } from "vitest";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import {
  type ApiDoor,
  bindApiDoor,
  DuplicateApiDoorError,
  MissingApiDoorError,
  openApiDoor,
  type RestIdentity,
} from "../api-door.ts";

const refuse = () => Promise.reject(new Error("this door decides nothing"));
const nobody: RestIdentity = { authenticate: refuse, identify: refuse };

function door(): ApiDoor {
  return {
    sessions: () => Promise.resolve(null),
    authz: {
      ...authorizeDefaults,
      getDecision: refuse,
      getProjectAnyDecision: refuse,
      checkScopeLineage: refuse,
      getSessionVersion: refuse,
    },
    identities: { project: nobody, organization: nobody, api_key: nobody },
    entitlements: { holds: refuse },
    audit: { rest: { record: () => {} }, trpc: { record: () => {} } },
  };
}

const someBinding = { middlewareContext: "callerEmail" };

describe("opening the API door", () => {
  describe("given no installed module binds it", () => {
    /** @scenario "An api process with no module binding the door refuses to boot" */
    it("refuses by name, pointing at auth", () => {
      const opening = () =>
        openApiDoor({
          middlewareBindings: [{ feature: "trace", middlewareBindings: [someBinding] }],
        });

      expect(opening).toThrow(MissingApiDoorError);
      expect(opening).toThrow(/"auth"/);
    });
  });

  describe("given two modules bind it", () => {
    /** @scenario "Two modules binding the door refuse boot by name" */
    it("refuses, naming both", () => {
      const opening = () =>
        openApiDoor({
          middlewareBindings: [
            { feature: "auth", middlewareBindings: [bindApiDoor(door())] },
            { feature: "impostor", middlewareBindings: [bindApiDoor(door())] },
          ],
        });

      expect(opening).toThrow(DuplicateApiDoorError);
      expect(opening).toThrow(/auth, impostor/);
    });
  });

  describe("given auth binds it among its other middleware bindings", () => {
    /** @scenario "The bound door is the one every host answers through" */
    it("opens exactly the door auth bound", () => {
      const bound = door();

      const opened = openApiDoor({
        middlewareBindings: [
          { feature: "trace", middlewareBindings: [someBinding] },
          { feature: "auth", middlewareBindings: [someBinding, bindApiDoor(bound)] },
        ],
      });

      expect(opened).toBe(bound);
    });

    /** @scenario "The bound door is the one every host answers through" */
    it("carries none of the keys a REST or tRPC mount takes middleware context by", () => {
      const binding = bindApiDoor(door());

      expect(
        "middlewareContext" in binding ||
          "trpcMiddlewareContext" in binding ||
          "credential" in binding,
      ).toBe(false);
    });
  });
});
