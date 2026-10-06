// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The per-tool direct-OTLP policy on the ingestion-key mint: the route repeats the
 * check the CLI makes, on the tool the request declares.
 * @see specs/ai-governance/cli-wrappers/instrument-command.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { DefaultGovernanceAiToolCatalogService } from "../ai-tool-catalog.service.ts";
import {
  GovernanceCliCredentialService,
  type GovernanceCliCredentialMembers,
} from "../governance-cli-credentials.service.ts";
import type { PersonalIngestionKeyService } from "../personal-ingestion-key.service.ts";

const caller = {
  user_id: "user_1",
  organization_id: "org_1",
  token_key: "token_1",
  cli_api_key_id: "login_1",
};

const MINTED = { token: "ik-lw-abc_secret", prefix: "ik-lw-abc" };

/** The organization turned direct OTLP off for claude only; every other tool keeps it. */
function setup() {
  const mint = vi.fn().mockResolvedValue(MINTED);
  const issueForProject = vi.fn().mockResolvedValue(MINTED);
  const resolveToolPolicy = vi.fn(async ({ slug }: { slug: string }) => ({
    allowVk: true,
    allowOtelDirect: slug !== "claude",
  }));
  const members: GovernanceCliCredentialMembers = {
    personalKeys: createApiFixture<GovernanceCliCredentialMembers["personalKeys"]>({}),
    ingestionKeys: createApiFixture<Pick<PersonalIngestionKeyService, "issueForProject" | "mint">>({
      mint,
      issueForProject,
    }),
    aiTools: createApiFixture<Pick<DefaultGovernanceAiToolCatalogService, "resolveToolPolicy">>({
      resolveToolPolicy,
    }),
    users: createApiFixture<GovernanceCliCredentialMembers["users"]>({}),
    projects: createApiFixture<GovernanceCliCredentialMembers["projects"]>({}),
    supportContacts: () => {
      throw new Error("supportContacts was not expected");
    },
    ensurePersonalWorkspace: async () => {
      throw new Error("ensurePersonalWorkspace was not expected");
    },
    getPersonalWorkspace: async () => {
      throw new Error("getPersonalWorkspace was not expected");
    },
    permittedOnProject: async () => {
      throw new Error("permittedOnProject was not expected");
    },
    budgets: createApiFixture<GovernanceCliCredentialMembers["budgets"]>({}),
    publicBaseUrl: "https://app.test",
  };

  return {
    service: GovernanceCliCredentialService.create(members),
    mint,
    issueForProject,
    resolveToolPolicy,
  };
}

describe("GovernanceCliCredentialService.mintIngestionKey", () => {
  describe("when the organization turned direct OTLP off for claude", () => {
    describe("and a CLI asks for a claude ingestion key", () => {
      /** @scenario A tool whose organization forbids direct OTLP mints no ingestion key */
      it("refuses by outcome and writes no key", async () => {
        const { service, mint, issueForProject } = setup();

        await expect(
          service.mintIngestionKey({
            caller,
            sourceType: "claude_code",
            projectRef: undefined,
            deviceLabel: undefined,
          }),
        ).resolves.toEqual({ outcome: "direct-otel-not-allowed", toolSlug: "claude" });

        expect(mint).not.toHaveBeenCalled();
        expect(issueForProject).not.toHaveBeenCalled();
      });

      it("refuses a project-scoped mint the same way", async () => {
        const { service, mint, issueForProject } = setup();

        await expect(
          service.mintIngestionKey({
            caller,
            sourceType: "claude_code",
            projectRef: "acme-app",
            deviceLabel: undefined,
          }),
        ).resolves.toEqual({ outcome: "direct-otel-not-allowed", toolSlug: "claude" });

        expect(mint).not.toHaveBeenCalled();
        expect(issueForProject).not.toHaveBeenCalled();
      });
    });

    describe("and a caller asks for a key and declares codex", () => {
      /** @scenario The mint policy reads the tool the request declares */
      it("reads codex's own policy and mints", async () => {
        const { service, mint, resolveToolPolicy } = setup();

        const outcome = await service.mintIngestionKey({
          caller,
          sourceType: "codex",
          projectRef: undefined,
          deviceLabel: undefined,
        });

        expect(resolveToolPolicy).toHaveBeenCalledTimes(1);
        expect(resolveToolPolicy).toHaveBeenCalledWith({
          organizationId: "org_1",
          userId: "user_1",
          slug: "codex",
        });
        expect(outcome).toMatchObject({ outcome: "minted", token: MINTED.token });
        expect(mint).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "codex" }));
      });
    });

    describe("and a caller asks for a key with a source type no wrapped tool stamps", () => {
      /** @scenario A source type outside the wrapped-tool set mints ungoverned */
      it("asks no policy and mints", async () => {
        const { service, mint, resolveToolPolicy } = setup();

        const outcome = await service.mintIngestionKey({
          caller,
          sourceType: "copilot_app",
          projectRef: undefined,
          deviceLabel: undefined,
        });

        expect(resolveToolPolicy).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({ outcome: "minted", token: MINTED.token });
        expect(mint).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "copilot_app" }));
      });

      it("does not mistake an inherited property name for a wrapped tool", async () => {
        const { service, resolveToolPolicy } = setup();

        await service.mintIngestionKey({
          caller,
          sourceType: "toString",
          projectRef: undefined,
          deviceLabel: undefined,
        });

        expect(resolveToolPolicy).not.toHaveBeenCalled();
      });
    });
  });
});
