// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `ingestionTemplates.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/ingestionTemplates.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type {
  CreateIngestionTemplateInput,
  GovernanceRestApi,
  IngestionTemplate,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { ingestionTemplatesTrpcTransport } from "../ingestion-templates.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const template: IngestionTemplate = {
  id: "tpl_1",
  slug: "cursor",
  sourceType: "cursor",
  displayName: "Cursor",
  description: null,
  iconAsset: null,
  credentialSchema: null,
  ottlRules: "",
  platformPublished: false,
  enabled: true,
  organizationId: "org_1",
};

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const created: CreateIngestionTemplateInput[] = [];
  const archived: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    templateListForUser: async () => [template],
    templateCreateOrg: async (input) => {
      created.push(input);
      return template;
    },
    templateArchiveOrg: async (input) => {
      archived.push(input);
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    ingestionTemplatesTrpcTransport,
    () => app,
  );

  return {
    router,
    asked,
    created,
    archived,
    caller: router.createCaller({ actor: { id: "user_1" } }),
  };
}

describe("the ingestionTemplates tRPC namespace", () => {
  it("serves main's procedure names with main's query and mutation kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      adminList: "query",
      get: "query",
      create: "mutation",
      updateOttlRules: "mutation",
      archive: "mutation",
      cloneFromPlatform: "mutation",
    });
  });

  it("lists the member's templates under aiTools:view", async () => {
    const { caller, asked } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([template]);
    expect(asked).toEqual(["aiTools:view"]);
  });

  describe("when an admin creates a template", () => {
    it("attributes it to the caller under aiTools:manage", async () => {
      const { caller, asked, created } = mount();

      await caller.create({ organizationId: "org_1", sourceType: "cursor", displayName: "Cursor" });

      expect(asked).toEqual(["aiTools:manage"]);
      expect(created).toEqual([
        expect.objectContaining({ organizationId: "org_1", callerUserId: "user_1" }),
      ]);
    });
  });

  describe("when an admin archives a template", () => {
    it("answers main's acknowledgement", async () => {
      const { caller, archived } = mount();

      await expect(caller.archive({ organizationId: "org_1", id: "tpl_1" })).resolves.toEqual({
        ok: true,
      });
      expect(archived).toEqual([{ organizationId: "org_1", id: "tpl_1", callerUserId: "user_1" }]);
    });
  });

  describe("given a member without aiTools:manage", () => {
    it("refuses the admin list before the application is reached", async () => {
      const { caller } = mount((permission) => permission === "aiTools:view");

      await expect(caller.adminList({ organizationId: "org_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
