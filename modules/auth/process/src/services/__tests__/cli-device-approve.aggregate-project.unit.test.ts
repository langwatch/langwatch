/**
 * A project-key CLI login never binds to an aggregate project (ADR-177 decision 7).
 *
 * @see specs/governance/aggregate-project.feature
 */
import { CliDeviceFlowRefusedError } from "@langwatch/auth-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { CliDeviceDirectory } from "../cli-device-directory.service.ts";
import {
  CliDeviceFlowService,
  type CliDeviceFlowCollaborators,
} from "../cli-device-flow.service.ts";
import type { CliDeviceSessionService } from "../cli-device-session.service.ts";

describe("CliDeviceFlowService.approveDeviceCode", () => {
  describe("when the picked project is an aggregate", () => {
    it("refuses with aggregate_project_has_no_credential before any access check", async () => {
      const canViewProject = vi.fn().mockResolvedValue(true);
      const approveDeviceCode = vi.fn();
      const flow = CliDeviceFlowService.create({
        collaborators: createApiFixture<CliDeviceFlowCollaborators>({
          session: async () => ({ id: "user-1", email: "ana@example.com" }),
          directory: () =>
            createApiFixture<CliDeviceDirectory>({
              hasActiveMembership: async () => true,
              getLiveProject: async () => ({
                id: "project-1",
                slug: "rollup",
                name: "Rollup",
                isPersonal: false,
                ownerUserId: null,
                kind: "aggregate",
              }),
            }),
          sessions: () =>
            createApiFixture<CliDeviceSessionService>({
              getDeviceCodeByUserCode: async () => ({
                device_code: "device-1",
                user_code: "ABCD-EFGH",
                status: "pending",
                created_at: nowInstant().epochMilliseconds,
                expires_at: nowInstant().epochMilliseconds + 60_000,
                credential_type: "project_api_key",
              }),
              approveDeviceCode,
            }),
          canViewProject,
        }),
      });

      const refusal = flow.approveDeviceCode({
        raw: JSON.stringify({
          user_code: "ABCD-EFGH",
          organization_id: "organization-1",
          project_id: "project-1",
        }),
        headers: new Headers(),
      });

      await expect(refusal).rejects.toBeInstanceOf(CliDeviceFlowRefusedError);
      await expect(refusal).rejects.toMatchObject({
        httpStatus: 403,
        refusal: { error: "aggregate_project_has_no_credential" },
      });
      expect(canViewProject).not.toHaveBeenCalled();
      expect(approveDeviceCode).not.toHaveBeenCalled();
    });
  });
});
