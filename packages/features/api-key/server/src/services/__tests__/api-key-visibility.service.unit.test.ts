/**
 * Which projects a credential can see. Refusals matter more than answers: a
 * key of another organization resolves to nothing, and past the candidate
 * limit it THROWS rather than truncating into a complete-looking list.
 */

import { describe, expect, it } from "vitest";
import { ProjectVisibilityTooWideError } from "@langwatch/api-key-contract";
import { ApiKeyVisibilityService } from "../api-key-visibility.service.ts";

type Binding = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

function serviceWith(options: {
  key?: { id: string; roleBindings: Binding[] } | null;
  organizationWide?: boolean;
  candidates?: Array<{ id: string; teamId: string }>;
  hasMore?: boolean;
  viewable?: string[];
}) {
  const asked: Array<Record<string, unknown>> = [];
  const service = ApiKeyVisibilityService.create({
    repository: {
      findByIdInOrganization: async (input: Record<string, unknown>) => {
        asked.push({ method: "findByIdInOrganization", ...input });
        return options.key === undefined
          ? { id: "key-1", roleBindings: [] as Binding[] }
          : options.key;
      },
    },
    authz: {
      can: async () => options.organizationWide ?? false,
      canBatchByIds: async () => ({
        projects: new Map((options.viewable ?? []).map((id) => [id, true])),
      }),
    },
    projects: {
      listActiveByScopes: async (input: Record<string, unknown>) => {
        asked.push({ method: "listActiveByScopes", ...input });
        return { data: options.candidates ?? [], hasMore: options.hasMore ?? false };
      },
    },
  } as never);

  return { asked, service };
}

const INPUT = { apiKeyId: "key-1", organizationId: "organization-1" };

describe("ApiKeyVisibilityService.resolveVisibleProjects", () => {
  describe("given a key that is not in this organization", () => {
    describe("when its visibility is resolved", () => {
      it("sees nothing, rather than falling through to a wider answer", async () => {
        const { service } = serviceWith({ key: null });

        await expect(service.resolveVisibleProjects(INPUT)).resolves.toEqual({
          kind: "some",
          ids: [],
        });
      });

      it("looked the key up within the organization it was asked about", async () => {
        const { service, asked } = serviceWith({ key: null });

        await service.resolveVisibleProjects(INPUT);

        expect(asked[0]).toMatchObject({ id: "key-1", organizationId: "organization-1" });
      });
    });
  });

  describe("given a key that may view the whole organization", () => {
    describe("when its visibility is resolved", () => {
      it("answers all, without listing a single project", async () => {
        const { service, asked } = serviceWith({ organizationWide: true });

        await expect(service.resolveVisibleProjects(INPUT)).resolves.toEqual({ kind: "all" });
        expect(asked.some((call) => call.method === "listActiveByScopes")).toBe(false);
      });
    });
  });

  describe("given a key bound to particular scopes", () => {
    describe("when candidates are gathered", () => {
      it("asks for exactly the teams and projects its bindings name", async () => {
        const { service, asked } = serviceWith({
          key: {
            id: "key-1",
            roleBindings: [
              { scopeType: "TEAM", scopeId: "team-1" },
              { scopeType: "TEAM", scopeId: "team-1" },
              { scopeType: "PROJECT", scopeId: "project-9" },
            ],
          },
        });

        await service.resolveVisibleProjects(INPUT);

        const listed = asked.find((call) => call.method === "listActiveByScopes");
        expect(listed).toMatchObject({
          organizationId: "organization-1",
          organizationWide: false,
          teamIds: ["team-1"],
          projectIds: ["project-9"],
        });
      });

      it("marks the listing organization-wide only when a binding says so", async () => {
        const { service, asked } = serviceWith({
          key: {
            id: "key-1",
            roleBindings: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
          },
        });

        await service.resolveVisibleProjects(INPUT);

        expect(asked.find((call) => call.method === "listActiveByScopes")).toMatchObject({
          organizationWide: true,
        });
      });
    });
  });

  describe("given more candidates than the scan will bound", () => {
    describe("when its visibility is resolved", () => {
      it("refuses, rather than answering with the ones it happened to read", async () => {
        const { service } = serviceWith({
          candidates: [{ id: "project-1", teamId: "team-1" }],
          hasMore: true,
        });

        await expect(service.resolveVisibleProjects(INPUT)).rejects.toBeInstanceOf(
          ProjectVisibilityTooWideError,
        );
      });
    });
  });

  describe("given candidates the key cannot all view", () => {
    describe("when its visibility is resolved", () => {
      it("returns only the ones authorization allows", async () => {
        const { service } = serviceWith({
          candidates: [
            { id: "project-1", teamId: "team-1" },
            { id: "project-2", teamId: "team-1" },
          ],
          viewable: ["project-2"],
        });

        await expect(service.resolveVisibleProjects(INPUT)).resolves.toEqual({
          kind: "some",
          ids: ["project-2"],
        });
      });
    });

    describe("when authorization allows none of them", () => {
      it("returns an empty list rather than the candidates", async () => {
        const { service } = serviceWith({
          candidates: [{ id: "project-1", teamId: "team-1" }],
          viewable: [],
        });

        await expect(service.resolveVisibleProjects(INPUT)).resolves.toEqual({
          kind: "some",
          ids: [],
        });
      });
    });
  });
});
