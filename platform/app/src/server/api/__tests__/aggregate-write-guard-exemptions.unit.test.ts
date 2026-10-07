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

const isWriteAction = (permission: AuthzPermission) => {
  const action = permission.split(":")[1];
  return action !== "view" && action !== "viewOtherPersonal";
};

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

  describe("when every write mutation is listed", () => {
    it("exempts exactly the permissions of the organisation, project and team resources", () => {
      const exempt = [
        ...new Set(
          mutations
            .filter(
              ({ permission }) =>
                isWriteAction(permission) && !writesUnderProject(permission),
            )
            .map(({ permission }) => permission),
        ),
      ].sort();

      expect(exempt).toEqual(EXEMPT_PERMISSIONS);
    });

    it("lets through exactly these mutations that name a project", () => {
      const exempt = mutations
        .filter(
          ({ path, permission }) =>
            isWriteAction(permission) &&
            !writesUnderProject(permission) &&
            acceptsProjectId(inputsOf(path)),
        )
        .map(({ path }) => path)
        .sort();

      expect(exempt).toEqual(EXEMPT_MUTATIONS_NAMING_A_PROJECT);
    });
  });
});

/**
 * The mutations the exemption lets through on an aggregate, among those whose
 * input names a project. They are declared under the organisation or project
 * resource, so they stay open: the project's name, rule, key and archive, and
 * the settings-shaped writes that ride the same permission (retention, topic
 * clustering, model providers, pinned traces, share revocation, instant
 * evaluations). Narrowing any of these is a decision for the ADR, not a quiet
 * edit here.
 */
const EXEMPT_MUTATIONS_NAMING_A_PROJECT: string[] = [
  "dataRetention.killMutation",
  "dataRetention.triggerRetroactiveUpdate",
  "modelProvider.codexApplyCodingDefaults",
  "modelProvider.codexSignInPoll",
  "modelProvider.codexSignInStart",
  "pinnedTrace.pin",
  "pinnedTrace.unpin",
  "project.archiveById",
  "project.regenerateApiKey",
  "project.triggerTopicClustering",
  "project.update",
  "project.updateAggregateRule",
  "share.revokeAllTraceShares",
  "tracesV2.instantEval.enable",
];

/** The write permissions the guard lets through, as the router declares them. */
const EXEMPT_PERMISSIONS: AuthzPermission[] = [
  "organization:manage",
  "project:delete",
  "project:manage",
  "project:update",
  "team:manage",
];
