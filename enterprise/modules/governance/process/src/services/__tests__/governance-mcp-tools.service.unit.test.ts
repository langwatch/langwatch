import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  type GovernanceMcpServer,
  GovernanceMcpToolsService,
} from "../governance-mcp-tools.service.ts";

type RegisteredTool = (args: Record<string, unknown>) => Promise<{
  content: { type: "text"; text: string }[];
}>;

function recordingServer() {
  const tools = new Map<string, RegisteredTool>();
  const server: GovernanceMcpServer = {
    tool(name, _description, schema, cb) {
      tools.set(name, (args) => cb(z.object(schema).parse(args)));
      return undefined;
    },
  };
  return { server, tools };
}

function registered({ callerUserId, allowed }: { callerUserId?: string; allowed: boolean }) {
  const asked: string[] = [];
  const service = GovernanceMcpToolsService.create({
    projects: createApiFixture<ProjectApi>({
      findIdByLegacyApiKey: async () => "project_1",
      getOrganizationId: async () => "org_1",
    }),
    governance: createApiFixture<GovernanceRestApi>({
      templateListForUser: async ({ organizationId }) => {
        asked.push(`list:${organizationId}`);
        return [];
      },
    }),
    permissions: { holdsOrganizationPermission: async () => allowed },
  });
  const { server, tools } = recordingServer();
  service.register({ server, apiKey: "sk-lw-1", callerUserId });
  return { tools, asked };
}

describe("GovernanceMcpToolsService", () => {
  describe("when a session registers the governance tools", () => {
    it("installs every governance tool", () => {
      const { tools } = registered({ allowed: true });
      expect([...tools.keys()]).toHaveLength(9);
    });
  });

  describe("when a project-apiKey session reads the template list", () => {
    it("answers the organization's templates without a user", async () => {
      const { tools, asked } = registered({ allowed: false });
      const result = await tools.get("governance_ingestion_templates_list")!({});
      expect(asked).toEqual(["list:org_1"]);
      expect(result.content[0]!.text).toBe("[]");
    });
  });

  describe("when a project-apiKey session tries a write", () => {
    it("refuses with the OAuth requirement", async () => {
      const { tools } = registered({ allowed: true });
      const result = await tools.get("governance_ingestion_templates_archive")!({ id: "t1" });
      expect(result.content[0]!.text).toMatch(/^AUTH_REQUIRED: /);
    });
  });

  describe("when an OAuth caller lacks the permission", () => {
    it("refuses the read naming the permission", async () => {
      const { tools, asked } = registered({ callerUserId: "user_1", allowed: false });
      const result = await tools.get("governance_ingestion_templates_list")!({});
      expect(asked).toEqual([]);
      expect(result.content[0]!.text).toBe(
        "FORBIDDEN: caller lacks permission 'aiTools:view' on organization org_1",
      );
    });
  });
});
