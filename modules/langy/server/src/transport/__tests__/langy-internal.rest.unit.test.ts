/**
 * @see specs/langy/langy-internal-control-plane.feature
 * The addresses the Go agent and the worker already dial, and the door every
 * one of them answers behind. A rename here strands a running deployment's
 * other half, so the declaration is pinned rather than described.
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { langyInternalRest } from "../langy-internal.rest.ts";

type DeclaredRoute = Readonly<{
  method: string;
  path: string;
  operation: string;
  credential?: string;
  access?: { kind: string };
}>;

const declaration = langyInternalRest.router();
const routes: readonly DeclaredRoute[] = declaration.routes;

describe("the Langy internal control plane", () => {
  describe("given the declaration the two halves of a deployment share", () => {
    /** @scenario "The control plane publishes its three literal addresses" */
    it("serves the turn-result, credential-revoke and relay-frame paths literally", () => {
      expect(routes.map((route) => [route.method, route.path, route.operation])).toEqual([
        ["post", "/api/internal/langy/turn/:turnId/result", "ingestTurnResult"],
        ["post", "/api/internal/langy/credentials/revoke", "revokeWorkerSessionKey"],
        ["post", "/api/internal/langy/relay/frames", "streamRelayFrames"],
      ]);
    });

    /** @scenario "Every route answers behind the deployment's own bearer" */
    it("puts every route behind the shared secret and asks no permission of it", () => {
      expect(routes.map((route) => [route.credential, route.access?.kind])).toEqual([
        ["internalSecret", "authenticated"],
        ["internalSecret", "authenticated"],
        ["internalSecret", "authenticated"],
      ]);
    });

    /** @scenario "The control plane publishes no dated twin" */
    it("stays literal with no /api/v1 alias", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(false);
    });
  });
});
