/**
 * Every route that removes or disables something, on every door and verb, declares whether a
 * Langy key needs the click; an opt-out must be a route a Langy key cannot reach at all.
 * @vitest-environment node
 * @see specs/langy/langy-delete-confirmation.feature
 */
import { classifyForLangy } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type DeclaredRoute = Readonly<{
  method: string;
  methods?: readonly string[];
  path: string;
  operation: string;
  audit?: string;
  permission?: string;
  permissions?: readonly string[];
  permissionBy?: unknown;
  permissionTarget?: Readonly<{ at: string }>;
  permissionReach?: string;
  permissionPlatform?: unknown;
  access?: Readonly<{ kind: string }>;
  keyKinds?: readonly string[];
  credential?: string;
  confirmation?: unknown;
  confirmationExempt?: string;
}>;

type Declaration = Readonly<{ namespace: string; credential: string; routes: DeclaredRoute[] }>;

type Listed = Readonly<{ module: string; declaration: Declaration; route: DeclaredRoute }>;

const REMOVES = /delete|archive|disable|remove|revoke|purge|clear/i;

/** The doors that resolve an API key, and so the only ones a Langy session key can pass. */
const KEY_DOORS = new Set(["project", "organization", "api_key"]);

function removes(route: DeclaredRoute): boolean {
  const methods = route.methods ?? [route.method];
  return methods.includes("delete") || REMOVES.test(route.audit ?? "");
}

/**
 * Whether a Langy session key could get past this route's door and permission. The key is minted
 * with one project-scoped grant holding only what the Langy policy grants, so a route asked at the
 * organization, or asking anything the policy withholds, is out of its reach.
 */
function langyCanReach({ declaration, route }: Listed): boolean {
  const door = route.credential ?? declaration.credential;
  if (!KEY_DOORS.has(door)) return false;
  if (route.keyKinds && !route.keyKinds.includes("langy_session_key")) return false;
  if (route.permissionPlatform) return false;
  if (route.permissionReach === "organization") return false;
  // The organization door asks at the organization unless the route names a narrower scope.
  if (door === "organization" && !route.permissionTarget && !route.access) return false;

  const permissions = route.permissions ?? (route.permission ? [route.permission] : []);
  return permissions.every((permission) => classifyForLangy(permission).disposition === "granted");
}

function declaredRestRoutes(): Listed[] {
  return processModules.flatMap((module) =>
    (module.transports ?? []).flatMap((transport) => {
      if (transport.protocol !== "rest") return [];
      const declaration = transport.router() as Declaration;
      return declaration.routes.map((route) => ({ module: module.name, declaration, route }));
    }),
  );
}

const named = ({ module, declaration, route }: Listed): string =>
  `${module} ${route.method.toUpperCase()} /api/${declaration.namespace}${route.path} (${route.credential ?? declaration.credential}) ${JSON.stringify([route.permission ?? route.access?.kind, route.permissionTarget?.at, route.permissionReach])}`;

describe("the routes that remove or disable something", () => {
  const removing = declaredRestRoutes().filter(({ route }) => removes(route));

  describe("when any route removes or disables something, on any door", () => {
    /** @scenario "Every route that removes or disables something asks for the click" */
    it("declares the confirmation mark or says why it asks for none", () => {
      const undeclared = removing
        .filter(({ route }) => route.confirmation === undefined && !route.confirmationExempt)
        .map(named);

      expect(removing.length).toBeGreaterThan(40);
      expect(undeclared).toEqual([]);
    });
  });

  describe("when a Langy key can reach it", () => {
    /** @scenario "Every route that removes or disables something asks for the click" */
    it("asks for the click rather than opting out", () => {
      const reachable = removing.filter(langyCanReach);
      const optedOut = reachable.filter(({ route }) => route.confirmation === undefined).map(named);

      expect(reachable.length).toBeGreaterThan(20);
      expect(optedOut).toEqual([]);
    });
  });
});
