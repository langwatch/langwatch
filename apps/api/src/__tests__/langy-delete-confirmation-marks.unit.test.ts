/**
 * Every route a Langy session key can reach that removes or disables something asks for the
 * person's click first. Walks the installed list's REST declarations, so a new delete route that
 * forgets the mark fails here rather than running unconfirmed.
 * @vitest-environment node
 * @see specs/langy/langy-delete-confirmation.feature
 */
import { classifyForLangy } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type DeclaredRoute = Readonly<{
  method: string;
  path: string;
  operation: string;
  audit?: string;
  permission?: string;
  permissions?: readonly string[];
  keyKinds?: readonly string[];
  credential?: string;
  confirmation?: unknown;
  confirmationExempt?: string;
}>;

type Declaration = Readonly<{ namespace: string; credential: string; routes: DeclaredRoute[] }>;

const REMOVES = /delete|archive|disable|remove|revoke/i;

/** Only the project door tells a Langy session key apart, so only its routes can admit one. */
function admitsLangyKey(route: DeclaredRoute, declaration: Declaration): boolean {
  if ((route.credential ?? declaration.credential) !== "project") return false;
  if (route.keyKinds && !route.keyKinds.includes("langy_session_key")) return false;
  const permissions = route.permissions ?? (route.permission ? [route.permission] : []);
  return (
    permissions.length > 0 &&
    permissions.every((permission) => classifyForLangy(permission).disposition === "granted")
  );
}

function removes(route: DeclaredRoute): boolean {
  return route.method === "delete" || REMOVES.test(route.audit ?? "");
}

function declaredRestRoutes(): {
  module: string;
  declaration: Declaration;
  route: DeclaredRoute;
}[] {
  return processModules.flatMap((module) =>
    (module.transports ?? []).flatMap((transport) => {
      if (transport.protocol !== "rest") return [];
      const declaration = transport.router() as Declaration;
      return declaration.routes.map((route) => ({ module: module.name, declaration, route }));
    }),
  );
}

describe("the routes a Langy key can reach", () => {
  describe("when a route removes or disables something", () => {
    /** @scenario "Every route that removes or disables something asks for the click" */
    it("declares the confirmation mark or says why it asks for none", () => {
      const reachable = declaredRestRoutes().filter(
        ({ declaration, route }) => removes(route) && admitsLangyKey(route, declaration),
      );
      const unmarked = reachable
        .filter(({ route }) => route.confirmation === undefined && !route.confirmationExempt)
        .map(({ module, route }) => `${module} ${route.method.toUpperCase()} ${route.operation}`);

      expect(reachable.length).toBeGreaterThan(15);
      expect(unmarked).toEqual([]);
    });
  });
});
