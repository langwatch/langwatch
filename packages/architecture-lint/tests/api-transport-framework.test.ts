/**
 * `api-transport-through-framework`, on fixtures.
 *
 * Spec: packages/architecture-lint/specs/api-transport-through-framework.feature.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiTransportFrameworkFindings,
  lintApiTransportFramework,
} from "../src/api-transport-framework";

const CONVERTED_REST = `
import { createRestService } from "@langwatch/api/rest";
import { roleSchema } from "@langwatch/role-contract";

export function createRoleRestApp() {
  return createRestService({ name: "roles", maxInputBytes: 1024 })
    .get("/", "2026-09-01", (endpoint) =>
      endpoint
        .withInput(roleSchema)
        .withOutput(roleSchema)
        .withPermission("role:view", "projectId")
        .handle(async (c, input) => c.json(input)),
    )
    .build();
}
`;

const CONVERTED_TRPC = `
import { createTrpcService } from "@langwatch/api/trpc";
import { projectSchema } from "@langwatch/project-contract";

export class ProjectTrpcApi {
  static create(trpc, procedures) {
    return createTrpcService({ root: trpc, procedures })
      .query("get", (p) =>
        p
          .withInput(projectSchema)
          .withOutput(projectSchema)
          .withPermission("project:view")
          .handle(async ({ input }) => input),
      )
      .build();
  }
}
`;

describe("apiTransportFrameworkFindings", () => {
  describe("given a family already defined through the framework", () => {
    /** @scenario "A transport file defined through the framework passes" */
    it("reports nothing, on either surface", () => {
      expect(apiTransportFrameworkFindings("role.api.ts", CONVERTED_REST, "rest")).toEqual([]);
      expect(apiTransportFrameworkFindings("project.api.ts", CONVERTED_TRPC, "trpc")).toEqual([]);
    });
  });

  describe("given a REST family that reaches for the framework underneath", () => {
    /** @scenario "A REST transport file that hand-rolls its routes is refused" */
    it("names hono-openapi's door, the zod validator and its own Hono app", () => {
      const source = `
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { zValidator } from "@hono/zod-validator";

const app = new Hono();
app.get("/", describeRoute({}), validator("query", schema), (c) => c.json({}));
`;
      const messages = apiTransportFrameworkFindings("legacy.api.ts", source, "rest").map(
        (finding) => finding.message,
      );

      expect(messages).toEqual([
        'REST transport imports describeRoute, resolver, validator from "hono-openapi".',
        'REST transport imports "@hono/zod-validator".',
        "REST transport constructs Hono of its own.",
      ]);
    });
  });

  describe("given a tRPC transport file that builds its own router", () => {
    /** @scenario "A tRPC transport file that builds a bare router is refused" */
    it("names the second root, the bare router and the parser applied outside the chain", () => {
      const source = `
import { initTRPC } from "@trpc/server";

const trpc = initTRPC.context().create();
export const router = trpc.router({
  get: policy("project:view")(procedure.input(schema)).query(handler),
});
`;
      const messages = apiTransportFrameworkFindings("legacy.api.ts", source, "trpc").map(
        (finding) => finding.message,
      );

      expect(messages).toEqual([
        "tRPC transport calls initTRPC; a feature must not create a second root.",
        "tRPC transport builds a bare router({ … }).",
        "tRPC transport calls .input(...) outside the chain.",
      ]);
    });
  });

  describe("given a transport file that still gates on a role", () => {
    /** @scenario "A transport file that names the legacy RBAC vocabulary is refused" */
    it("refuses the role enum and the role module, on either surface", () => {
      const source = `
import { checkUserPermissionForProject } from "~/server/api/permission";
import { TeamRoleGroup } from "../../rbac/groups";

export const guard = () => checkUserPermissionForProject(TeamRoleGroup.PROJECT_VIEW);
`;
      const findings = apiTransportFrameworkFindings("legacy.api.ts", source, "trpc");

      expect(findings.map((finding) => finding.message)).toEqual([
        'Transport file imports the legacy RBAC module "../../rbac/groups".',
        "Transport file names the legacy RBAC identifier checkUserPermissionForProject.",
        "Transport file names the legacy RBAC identifier TeamRoleGroup.",
      ]);
    });
  });

  describe("given a file that was converted but left its allowlist entry behind", () => {
    /** @scenario "The allowlist of unconverted files only shrinks" */
    it("reports the stale entry, so the list can only shrink", () => {
      const root = mkdtempSync(join(tmpdir(), "api-transport-framework-"));
      mkdirSync(join(root, "packages/architecture-lint/src"), { recursive: true });
      writeFileSync(
        join(root, "packages/architecture-lint/src/api-transport-framework-allowlist.json"),
        JSON.stringify({
          files: ["packages/features/gone/server/src/transport/api-rest/a.api.ts"],
        }),
      );

      const violations = lintApiTransportFramework(root, []);

      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(
        "still names packages/features/gone/server/src/transport/api-rest/a.api.ts",
      );
      expect(violations[0]?.allowed).toBe("Delete the entry. The list only shrinks.");
    });
  });
});
