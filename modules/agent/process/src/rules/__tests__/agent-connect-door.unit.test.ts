/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import { AgentRegisterRefusedError } from "@langwatch/agent-contract";
import {
  KeyKindRefusedError,
  ProjectInvalidCredentialsError,
  ProjectMissingCredentialsError,
  ProjectRequiredError,
} from "@langwatch/api";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import { describe, expect, it } from "vitest";

import { connectCallerOf } from "../agent-connect-caller.rules.ts";
import { connectRefusalOf, registerRefusal } from "../agent-connect-refusal.rules.ts";

const project = {
  id: "project_1",
  name: "Project",
  slug: "project-one",
  teamId: "team_1",
  organizationId: "org_1",
  isPersonal: false,
  ownerUserId: null,
};

function apiKey(userId: string | null) {
  return {
    type: "apiKey" as const,
    apiKeyId: "key_1",
    userId,
    organizationId: "org_1",
    ingestSourceType: null,
    ingestionTemplateId: null,
    project,
  };
}

describe("connectCallerOf", () => {
  describe("given what the project door resolved", () => {
    it("keeps main's stored principal for each kind of key, so live sessions survive a deploy", () => {
      expect(connectCallerOf(apiKey("user_1"))).toEqual({
        project: { id: "project_1", slug: "project-one" },
        userId: "user_1",
        principalId: "user:user_1",
      });
      expect(connectCallerOf(apiKey(null))).toMatchObject({
        userId: null,
        principalId: "key:key_1",
      });
      expect(connectCallerOf({ type: "legacyProjectKey", project })).toMatchObject({
        userId: null,
        principalId: "legacy-project:project_1",
      });
    });
  });
});

describe("connectRefusalOf", () => {
  /** @scenario "A key that reaches several projects must name one" */
  it("answers a project_required refusal listing the projects the key reaches", () => {
    const projects = [
      { id: "project_a", name: "A" },
      { id: "project_b", name: "B" },
    ];

    expect(connectRefusalOf(new ProjectRequiredError({ projects }))).toEqual({
      framed: true,
      refusal: expect.objectContaining({ reason: "project_required", meta: { projects } }),
    });
  });

  /** @scenario "An invalid key cannot connect" */
  it("answers a missing, unknown or person's credential as api_key_invalid at 401", () => {
    for (const failure of [
      new ProjectMissingCredentialsError(),
      new ProjectInvalidCredentialsError(),
      new KeyKindRefusedError("access_token"),
    ]) {
      expect(connectRefusalOf(failure)).toMatchObject({
        framed: true,
        refusal: { reason: "api_key_invalid" },
      });
    }
  });

  /** @scenario "An ingestion key cannot connect" */
  /** @scenario "A Langy session key cannot connect" */
  /** @scenario "Unsupported credentials cannot discover projects" */
  it("answers an ingestion or Langy session key as key_type_not_allowed at 403", () => {
    for (const kind of ["ingestion_key", "langy_session_key"] as const) {
      expect(connectRefusalOf(new KeyKindRefusedError(kind))).toMatchObject({
        framed: true,
        refusal: { reason: "key_type_not_allowed" },
      });
    }
  });

  /** @scenario "A key without scenarios manage cannot connect" */
  it("answers the door's permission denial as permission_denied at 403", () => {
    expect(connectRefusalOf(new ApiKeyPermissionDeniedError("scenarios:manage"))).toMatchObject({
      framed: true,
      refusal: { reason: "permission_denied" },
    });
  });

  it("leaves the protocol's own refusal and anything it never framed unframed", () => {
    const own = new AgentRegisterRefusedError({ reason: "protocol_invalid", message: "no" });

    expect(connectRefusalOf(own)).toEqual({ framed: false });
    expect(connectRefusalOf(new Error("database down"))).toEqual({ framed: false });
    expect(registerRefusal(new Error("database down"))).toEqual({ kind: "declined" });
  });
});
