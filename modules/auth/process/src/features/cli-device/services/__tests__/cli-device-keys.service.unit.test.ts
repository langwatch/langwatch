/**
 * @vitest-environment node
 * The personal project a device session names, and none while it is still being created.
 * @see specs/ai-gateway/governance/cli-login.feature
 */
import type { EnsuredPersonalWorkspace } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { CliDeviceFlowCollaborators } from "../cli-device-flow.service.ts";
import { CliDeviceKeysService } from "../cli-device-keys.service.ts";

const TEAM = { id: "team_personal", name: "Personal", slug: "personal", createdAtMs: 0 };
const READY: EnsuredPersonalWorkspace = {
  kind: "ready",
  workspace: {
    team: TEAM,
    project: {
      id: "project_personal",
      name: "Ada",
      slug: "personal-ada",
      apiKey: "key",
      createdAtMs: 0,
    },
  },
};
const PENDING: EnsuredPersonalWorkspace = {
  kind: "pending",
  team: TEAM,
};

function serviceWhere(ensured: EnsuredPersonalWorkspace): CliDeviceKeysService {
  return CliDeviceKeysService.create({
    flow: createApiFixture<CliDeviceFlowCollaborators>({
      ensurePersonalWorkspace: async () => ensured,
    }),
  });
}

const user = { id: "user_1", name: "Ada", email: "ada@example.com" };
const organization = { id: "org_1" };

describe("CliDeviceKeysService.personalProjectFieldsOf", () => {
  it("names the personal project once it exists", async () => {
    await expect(
      serviceWhere(READY).personalProjectFieldsOf({ user, organization }),
    ).resolves.toEqual({
      personal_project: { id: "project_personal", slug: "personal-ada", name: "Ada" },
    });
  });

  /** @scenario "A device session names no personal project while it is still being created" */
  it("ships no personal project while it is still being created", async () => {
    await expect(
      serviceWhere(PENDING).personalProjectFieldsOf({ user, organization }),
    ).resolves.toEqual({});
  });
});
