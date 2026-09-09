/**
 * The one list, proved to be one list: what this process mounts, and what it
 * names absent. A namespace that is neither would be invisible to both.
 */
import { describe, expect, it } from "vitest";

import { ABSENT_API_TRPC_NAMESPACES } from "../app-trpc.namespaces.ts";
import { buildAppTrpcFeatures } from "./support/app-trpc-features.ts";

/** The procedure paths one mounted router answers on. */
const procedureNamesOf = (router: unknown): string[] =>
  Object.keys((router as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();

describe("the app tRPC feature list", () => {
  describe("given one process mount", () => {
    it("builds every namespace the app process serves from this package", () => {
      expect(Object.keys(buildAppTrpcFeatures()).sort()).toEqual([
        "analytics",
        "annotation",
        "annotationScore",
        "apiKey",
        "authz",
        "batchRecord",
        "codingAgents",
        "costs",
        "currency",
        "dashboards",
        "dataPrivacy",
        "dataRetention",
        "dataset",
        "datasetRecord",
        "evaluations",
        "evaluators",
        "featureFlag",
        "frontDoor",
        "github",
        "graphs",
        "home",
        "httpProxy",
        "identity",
        "integrationsChecks",
        "license",
        "licenseEnforcement",
        "limits",
        "monitors",
        "pinnedTrace",
        "plan",
        "presence",
        "project",
        "publicEnv",
        "role",
        "roleBinding",
        "savedViews",
        "scimToken",
        "secrets",
        "share",
        "ssoConnections",
        "storedObjects",
        "subscription",
        "topics",
        "user",
        "webhookEndpoints",
      ]);
    });

    it("names every namespace it does not mount, so none is invisible", () => {
      const mounted = new Set(Object.keys(buildAppTrpcFeatures()));
      const absent = ABSENT_API_TRPC_NAMESPACES.map((entry) => entry.namespace);

      expect(absent.filter((namespace) => mounted.has(namespace))).toEqual([]);
      expect(new Set(absent).size).toBe(absent.length);
    });

    it("hands back the packaged transport for each namespace, procedure names intact", () => {
      const features = buildAppTrpcFeatures();

      // The analytics namespace, with only the DASHBOARD's half converted. The
      // dotted names are what makes the merge visible, so a door that quietly
      // moved to a different name fails here rather than at a client.
      expect(procedureNamesOf(features.analytics)).toEqual([
        "savedWorkbenchCharts.create",
        "savedWorkbenchCharts.delete",
        "savedWorkbenchCharts.getAll",
        "savedWorkbenchCharts.getById",
        "savedWorkbenchCharts.run",
        "savedWorkbenchCharts.update",
      ]);
      expect(procedureNamesOf(features.annotationScore)).toEqual([
        "delete",
        "getAll",
        "getAllActive",
        "getById",
        "toggle",
        "upsert",
      ]);
      expect(procedureNamesOf(features.apiKey)).toEqual([
        "create",
        "list",
        "myBindings",
        "nameById",
        "orgMembers",
        "orgProjects",
        "orgTeams",
        "revoke",
        "update",
      ]);
      // The privacy settings screen: one read and the two writes it drives.
      // Every answer comes back through a port, so what this pins is that the
      // three names the settings page calls are the packaged ones.
      expect(procedureNamesOf(features.dataPrivacy)).toEqual([
        "getSnapshot",
        "removeForScope",
        "setForScope",
      ]);
      expect(procedureNamesOf(features.identity)).toEqual(["completeVerification"]);
      // The project's setup rollup. Its evidence comes from nine other
      // verticals through a port, so the one thing this pins is that the
      // procedure the onboarding surfaces call is the packaged one.
      expect(procedureNamesOf(features.integrationsChecks)).toEqual(["getCheckStatus"]);
      // Who else is in the project. `onPresenceUpdate` and `onPresenceCursor`
      // are the two of this namespace's procedures that STREAM, which is the
      // reason presence is in the record at all: mounted beside it they would
      // answer over `/api/trpc` and be invisible to the subscription lane.
      expect(procedureNamesOf(features.presence)).toEqual([
        "cursor",
        "leave",
        "onPresenceCursor",
        "onPresenceUpdate",
        "update",
      ]);
      // The account surface. `personalUsage`, `budgetOverview` and
      // `cliBootstrap` are NOT here: the Enterprise /me dashboard that used to
      // merge onto this name is on the absence list as `personalDashboard`.
      expect(procedureNamesOf(features.user)).toEqual([
        "changePassword",
        "deactivate",
        "dismissPasskeyNudge",
        "dismissTraceExplorerTour",
        "getAccountInfo",
        "getLinkedAccounts",
        "getSsoStatus",
        "getTraceExplorerTourPreference",
        "hasPassword",
        "homePagePickerState",
        "isAdmin",
        "passkeyNudge",
        "personalBudget",
        "personalContext",
        "reactivate",
        "register",
        "removeAvatar",
        "requestBudgetIncrease",
        "setAvatar",
        "setLastHomePath",
        "setPassword",
        "unlinkAccount",
        "updateLastLogin",
      ]);
    });

    it("mounts publicEnv as a bare procedure, because that is the name the client calls", () => {
      const publicEnv = buildAppTrpcFeatures().publicEnv as {
        _def: { type: string; procedure: boolean };
      };

      expect(publicEnv._def.procedure).toBe(true);
      expect(publicEnv._def.type).toBe("query");
    });

    it("leaves no namespace without procedures", () => {
      const features = buildAppTrpcFeatures();
      const routers = Object.entries(features).filter(([name]) => name !== "publicEnv");

      for (const [name, router] of routers) {
        expect({ name, procedures: procedureNamesOf(router).length > 0 }).toEqual({
          name,
          procedures: true,
        });
      }
    });
  });
});
