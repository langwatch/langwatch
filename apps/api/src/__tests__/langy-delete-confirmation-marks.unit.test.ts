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
  keepsRecords?: true;
}>;

type Declaration = Readonly<{ namespace: string; credential: string; routes: DeclaredRoute[] }>;

type Listed = Readonly<{ module: string; declaration: Declaration; route: DeclaredRoute }>;

const WRITES = new Set(["post", "put", "patch", "delete"]);

/** A name that says the route removes something; such a route cannot say it keeps records. */
const NAMES_A_REMOVAL = /delete|archive|disable|remove|revoke|purge|clear/i;

/** The doors that resolve an API key, and so the only ones a Langy session key can pass. */
const KEY_DOORS = new Set(["project", "organization", "api_key"]);

function writes(route: DeclaredRoute): boolean {
  return (route.methods ?? [route.method]).some((method) => WRITES.has(method));
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

describe("the write routes", () => {
  const writing = declaredRestRoutes().filter(({ route }) => writes(route));

  describe("when any route writes, on any door", () => {
    /** @scenario "Every route that removes or disables something asks for the click" */
    it("says whether it removes: the mark, a reason for none, or that it keeps records", () => {
      const undeclared = writing
        .filter(
          ({ route }) =>
            route.confirmation === undefined && !route.confirmationExempt && !route.keepsRecords,
        )
        .map(named);

      expect(writing.length).toBeGreaterThan(200);
      expect(undeclared).toEqual([]);
    });

    /** @scenario "Every route that removes or disables something asks for the click" */
    it("never says it keeps records when its audit names a removal", () => {
      const misnamed = writing
        .filter(({ route }) => route.keepsRecords && NAMES_A_REMOVAL.test(route.audit ?? ""))
        .map(named);

      expect(misnamed).toEqual([]);
    });
  });

  describe("when a Langy key can reach it", () => {
    /** @scenario "Every route that removes or disables something asks for the click" */
    it("asks for the click rather than opting out", () => {
      const reachable = writing.filter(langyCanReach);
      const optedOut = reachable.filter(({ route }) => route.confirmationExempt).map(named);

      expect(reachable.length).toBeGreaterThan(50);
      expect(optedOut).toEqual([]);
    });
  });
});
