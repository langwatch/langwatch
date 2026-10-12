/** @vitest-environment node */

/**
 * ADR-144 decision 8: every mutation declared under a write permission on a
 * project-tier resource is refused on an aggregate at the door. The ones
 * that manage the project itself are exempt by the resource of the
 * permission they declare, never by router name. This pins, from the real
 * router, which mutations that exemption reaches and which of the writes the
 * aggregate's admin cares about it does not, so a new procedure under an
 * exempt permission shows up here for review.
 */
import {
  type AuthzDeclaration,
  type AuthzPermission,
  authzDeclarationOf,
} from "@langwatch/authz";
import { describe, expect, it } from "vitest";
import { writesUnderProject } from "~/server/app-layer/projects/project-write-guard";
import { appRouter } from "../root";

type Mutation = { path: string; permission: AuthzPermission };

/** Every mutation declared under a single permission, with that permission. */
function declaredMutations(): Mutation[] {
  const procedures = (
    appRouter as unknown as { _def: { procedures: Record<string, unknown> } }
  )._def.procedures;
  return Object.entries(procedures).flatMap(([path, procedure]) => {
    const def = (procedure as { _def?: Record<string, any> })._def ?? {};
    if (def.type !== "mutation") return [];
    const declaration: AuthzDeclaration | null =
      (def.middlewares ?? [])
        .map((middleware: unknown) => authzDeclarationOf(middleware))
        .find((found: AuthzDeclaration | null) => found !== null) ?? null;
    return declaration?.kind === "permission"
      ? [{ path, permission: declaration.permission }]
      : [];
  });
}

function inputsOf(path: string): unknown[] {
  const procedures = (
    appRouter as unknown as { _def: { procedures: Record<string, any> } }
  )._def.procedures;
  return procedures[path]?._def?.inputs ?? [];
}

/** Whether any of a procedure's input parsers carries a `projectId` field,
 *  looking through refinements, defaults, optionals and intersections. */
function acceptsProjectId(inputs: unknown[]): boolean {
  const carries = (schema: any, depth: number): boolean => {
    if (!schema?._def || depth > 10) return false;
    const def = schema._def;
    if (def.left || def.right) {
      return carries(def.left, depth + 1) || carries(def.right, depth + 1);
    }
    if (def.options) {
      const options =
        def.options instanceof Map ? [...def.options.values()] : def.options;
      return options.some((option: unknown) => carries(option, depth + 1));
    }
    const inner = def.schema ?? def.innerType ?? def.in;
    if (inner) return carries(inner, depth + 1);
    const shape = typeof def.shape === "function" ? def.shape() : def.shape;
    return shape !== undefined && "projectId" in shape;
  };
  return inputs.some((input) => carries(input, 0));
}

describe("the aggregate write guard's exemptions", () => {
  const mutations = declaredMutations();
  const permissionOf = (path: string) =>
    mutations.find((mutation) => mutation.path === path)?.permission;

  describe("when the admin manages the aggregate itself", () => {
    it("declares permissions the guard exempts", () => {
      for (const path of [
        "project.updateAggregateRule",
        "project.update",
        "project.archiveById",
      ]) {
        const permission = permissionOf(path);
        expect(permission, path).toBeDefined();
        expect(writesUnderProject(permission as AuthzPermission), path).toBe(
          false,
        );
      }
    });
  });

  describe("when a write lands under the project's tenant", () => {
    it("declares permissions the guard refuses", () => {
      for (const path of [
        "experiments.saveExperiment",
        "dataset.upsert",
        "annotation.create",
        "prompts.create",
        "tracesV2.changeName",
        "tracesV2.changeMetadata",
        "monitors.create",
      ]) {
        const permission = permissionOf(path);
        expect(permission, path).toBeDefined();
        expect(writesUnderProject(permission as AuthzPermission), path).toBe(
          true,
        );
      }
    });
  });

  describe("when every mutation is listed", () => {
    it("lets through exactly these permissions", () => {
      const letThrough = [
        ...new Set(
          mutations
            .filter(({ permission }) => !writesUnderProject(permission))
            .map(({ permission }) => permission),
        ),
      ].sort();

      expect(letThrough).toEqual(LET_THROUGH_PERMISSIONS);
    });

    it("lets through exactly these mutations that name a project", () => {
      const letThrough = mutations
        .filter(
          ({ path, permission }) =>
            !writesUnderProject(permission) && acceptsProjectId(inputsOf(path)),
        )
        .map(({ path }) => path)
        .sort();

      expect(letThrough).toEqual(LET_THROUGH_MUTATIONS_NAMING_A_PROJECT);
    });
  });
});

/**
 * Every mutation the guard lets through on an aggregate, among those whose
 * input names a project, written out by hand rather than derived. Two kinds
 * are here. Those declared under the organisation, project or team resource
 * stay open by design: the project's name, rule, key and archive, and the
 * settings-shaped writes that ride the same permission (retention, topic
 * clustering, model providers, pinned traces, share revocation, instant
 * evaluations). Those declared under a view permission are reads shaped as
 * mutations, plus a few writes the ADR lists as not reached (saved views,
 * the Slack integration). Narrowing any of these is a decision for the ADR,
 * not a quiet edit here.
 */
const LET_THROUGH_MUTATIONS_NAMING_A_PROJECT: string[] = [
  "analytics.lwql.query",
  "analytics.savedWorkbenchCharts.run",
  "dataRetention.killMutation",
  "dataRetention.triggerRetroactiveUpdate",
  "datasetRecord.download",
  "evaluations.warmupLambda",
  "langy.claimUiAction",
  "langy.completeUiAction",
  "modelProvider.codexApplyCodingDefaults",
  "modelProvider.codexSignInPoll",
  "modelProvider.codexSignInStart",
  "monitors.isNameAvailable",
  "optimization.chat",
  "pinnedTrace.pin",
  "pinnedTrace.unpin",
  "presence.cursor",
  "presence.leave",
  "presence.update",
  "project.archiveById",
  "project.regenerateApiKey",
  "project.triggerTopicClustering",
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
  "traces.getAllForDownload",
  "tracesV2.aiAction",
  "tracesV2.aiQuery",
  "tracesV2.instantEval.enable",
  "tracesV2.routeSearch",
  "translate.translate",
];

/** The permissions the guard lets through, as the router declares them. */
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
  "team:manage",
  "traces:view",
  "virtualKeys:view",
  "workflows:view",
];
