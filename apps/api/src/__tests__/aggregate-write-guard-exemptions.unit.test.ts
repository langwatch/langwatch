/**
 * ADR-177 decision 8: the door refuses on an aggregate every mutation declared under a write on a
 * project-tier resource, exempting by permission resource, never by router. This pins, from the
 * installed declarations, which mutations that exemption reaches. Ported from main.
 * @vitest-environment node
 * @see specs/governance/aggregate-project.feature
 */
import type { TrpcAccess, TrpcProcedureRequest } from "@langwatch/api/trpc";
import { type AuthzPermission, writesUnderProject } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

type Mutation = { path: string; permissions: readonly AuthzPermission[]; namesProject: boolean };

/** The permissions the door admits a declaration under, as `declaredPermissions` reads them. */
function permissionsOf(access: TrpcAccess): readonly AuthzPermission[] {
  if (access.kind === "permission") return [access.permission];
  if (access.kind === "permission-any" || access.kind === "permission-all") {
    return access.permissions;
  }
  return [];
}

type ZodDef = { type?: string } & Record<string, unknown>;

function defOf(schema: unknown): ZodDef | undefined {
  if (typeof schema !== "object" || schema === null || !("_zod" in schema)) return undefined;
  const zod = schema._zod;
  if (typeof zod !== "object" || zod === null || !("def" in zod)) return undefined;
  const def = zod.def;
  return typeof def === "object" && def !== null ? { ...def } : undefined;
}

/** Whether a parser carries a `projectId` field, through wrappers, unions and intersections. */
function carriesProjectId(schema: unknown, depth = 0): boolean {
  const def = defOf(schema);
  if (!def || depth > 10) return false;
  if (def.type === "intersection") {
    return carriesProjectId(def.left, depth + 1) || carriesProjectId(def.right, depth + 1);
  }
  if (Array.isArray(def.options)) {
    return def.options.some((option) => carriesProjectId(option, depth + 1));
  }
  const inner = def.innerType ?? (def.type === "pipe" ? def.in : undefined);
  if (inner !== undefined) return carriesProjectId(inner, depth + 1);
  const shape = def.shape;
  return typeof shape === "object" && shape !== null && "projectId" in shape;
}

/** Every installed mutation that names permissions, mounted on a runtime that only records. */
function declaredMutations(): Mutation[] {
  const mutations: Mutation[] = [];
  const record = (request: TrpcProcedureRequest<object>) => {
    const permissions = permissionsOf(request.access);
    if (request.member.kind === "mutation" && permissions.length > 0) {
      mutations.push({
        path: request.procedure,
        permissions,
        namesProject: carriesProjectId(request.member.input),
      });
    }
    return request;
  };
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "trpc" || !("router" in transport)) continue;
      transport.router({ procedure: record, router: (routes) => routes }, () => {
        throw new Error("the recording runtime binds no application");
      });
    }
  }
  return mutations;
}

const letThrough = ({ permissions }: Mutation) => !permissions.some(writesUnderProject);

describe("the aggregate write guard's exemptions", () => {
  const mutations = declaredMutations();
  const find = (path: string) => mutations.find((mutation) => mutation.path === path);

  describe("when the admin manages the aggregate itself", () => {
    /** @scenario "Every write under the aggregate's tenant is refused on the server" */
    it.each(["project.updateAggregateRule", "project.update", "project.archiveById"])(
      "declares %s under a permission the guard exempts",
      (path) => {
        const mutation = find(path);
        expect(mutation, path).toBeDefined();
        expect(mutation && letThrough(mutation), path).toBe(true);
      },
    );
  });

  describe("when a write lands under the project's tenant", () => {
    /** @scenario "Every write under the aggregate's tenant is refused on the server" */
    it.each([
      "experiments.saveExperiment",
      "dataset.upsert",
      "annotation.create",
      "prompts.create",
      "traces.changeName",
      "traces.changeMetadata",
      "monitors.create",
    ])("declares %s under a permission the guard refuses", (path) => {
      const mutation = find(path);
      expect(mutation, path).toBeDefined();
      expect(mutation && letThrough(mutation), path).toBe(false);
    });
  });

  describe("when every mutation is listed", () => {
    it("lets through exactly these permissions", () => {
      const permissions = new Set(mutations.filter(letThrough).flatMap((m) => m.permissions));

      expect([...permissions].toSorted()).toEqual(LET_THROUGH_PERMISSIONS);
    });

    it("lets through exactly these mutations that name a project", () => {
      const paths = mutations.filter((m) => letThrough(m) && m.namesProject).map((m) => m.path);

      expect(paths.toSorted()).toEqual(LET_THROUGH_MUTATIONS_NAMING_A_PROJECT);
    });
  });
});

/**
 * Written by hand, not derived. Organisation, project and team writes stay open by design (pins
 * are refused in data-retention's service); view-declared ones are reads shaped as mutations.
 * Narrowing any of these is a decision for the ADR, not a quiet edit here.
 */
const LET_THROUGH_MUTATIONS_NAMING_A_PROJECT: string[] = [
  "analytics.lwql.query",
  "analytics.savedWorkbenchCharts.run",
  "dataRetention.killMutation",
  "dataRetention.triggerRetroactiveUpdate",
  "datasetRecord.download",
  "evaluations.warmupLambda",
  "instantEval.classifySearch",
  "instantEval.enable",
  "langy.claimUiAction",
  "langy.completeUiAction",
  "modelProvider.codexApplyCodingDefaults",
  "modelProvider.codexSignInPoll",
  "modelProvider.codexSignInStart",
  "monitors.isNameAvailable",
  "pinnedTrace.pin",
  "pinnedTrace.unpin",
  "presence.cursor",
  "presence.leave",
  "presence.update",
  "project.archiveById",
  "project.revokeProjectApiKey",
  "project.update",
  "project.updateAggregateRule",
  "savedViews.create",
  "savedViews.delete",
  "savedViews.rename",
  "savedViews.reorder",
  "share.revokeAllTraceShares",
  "slackIntegration.create",
  "slackIntegration.delete",
  "slackIntegration.update",
  "storedObjects.confirmUpload",
  "storedObjects.createUpload",
  "topics.triggerTopicClustering",
  "traces.aiAction",
  "traces.aiQuery",
  "traces.getAllForDownload",
  "traces.routeSearch",
  "translate.translate",
];

/** The permissions the guard lets through, as the installed declarations name them. */
const LET_THROUGH_PERMISSIONS: AuthzPermission[] = [
  "analytics:view",
  "datasets:view",
  "evaluations:view",
  "governance:view",
  "langy:view",
  "organization:manage",
  "organization:view",
  "project:delete",
  "project:manage",
  "project:update",
  "project:view",
  "secrets:view",
  "team:manage",
  "traces:view",
];
