/**
 * @vitest-environment node
 * @integration
 *
 * The two refusals the pull-request usage read answers with before it reads
 * anything: a workspace that is not one person's, and a key that does not own
 * the personal workspace it is pointed at. Plus the shape the endpoint
 * publishes, checked against the generated document rather than the source, so
 * a schema change that was never regenerated is caught here.
 *
 * Both refusals are asserted on their code rather than their sentence. The code
 * is the contract a CLI or an agent branches on; the sentence beside it is copy
 * and will change.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { generate } from "@langwatch/ksuid";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import publishedSpec from "../../openapiLangWatch.json";
import { app } from "../[[...route]]/app";

const ns = nanoid(8);
const USAGE_PATH =
  "/api/coding-agent/pull-request-usage?repository=acme/widgets&pullRequest=1";

let organization: Organization;
let team: Team;
let callerUserId: string;
/** A workspace belonging to the whole team rather than to one person. */
let sharedProject: { id: string; apiKey: string };
/** Somebody else's personal workspace, which the caller may nonetheless view. */
let otherUsersPersonalProjectId: string;
/** A user-bound key for the caller, carrying an org-wide admin binding. */
let callerToken: string;

const authHeaders = ({
  apiKey,
  projectId,
}: {
  apiKey: string;
  projectId: string;
}) => ({
  Authorization: `Bearer ${apiKey}`,
  "X-Project-Id": projectId,
});

beforeAll(async () => {
  organization = await prisma.organization.create({
    data: { name: `pr-usage-api-${ns}`, slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: `pr-usage-api-${ns}`,
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });

  const caller = await prisma.user.create({
    data: { name: "Caller", email: `caller-${ns}@example.com` },
  });
  callerUserId = caller.id;
  await prisma.organizationUser.create({
    data: {
      userId: callerUserId,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });

  const sharedApiKey = `sk-lw-${nanoid(48)}`;
  const shared = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Shared Project",
      slug: `--test-shared-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: sharedApiKey,
      teamId: team.id,
      isPersonal: false,
      ownerUserId: null,
    },
  });
  sharedProject = { id: shared.id, apiKey: sharedApiKey };

  const otherUser = await prisma.user.create({
    data: { name: "Other", email: `other-${ns}@example.com` },
  });
  await prisma.organizationUser.create({
    data: {
      userId: otherUser.id,
      organizationId: organization.id,
      role: OrganizationUserRole.MEMBER,
    },
  });
  const otherPersonal = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Personal Workspace",
      slug: `--test-other-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: `sk-lw-${nanoid(48)}`,
      teamId: team.id,
      isPersonal: true,
      ownerUserId: otherUser.id,
    },
  });
  otherUsersPersonalProjectId = otherPersonal.id;

  // Org-wide admin, so the caller genuinely holds `traces:view` on the other
  // user's workspace. The refusal has to come from ownership, not permission.
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId: callerUserId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });
  callerToken = (
    await ApiKeyService.create(prisma).create({
      name: `pr-usage-caller-${ns}`,
      userId: callerUserId,
      createdByUserId: callerUserId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    })
  ).token;
});

afterAll(async () => {
  const orgUsers = await prisma.organizationUser
    .findMany({ where: { organizationId: organization.id } })
    .catch(() => []);
  // Bindings before keys: a key-scoped RoleBinding requires its ApiKey, so
  // deleting the key first is refused outright.
  await cleanupTestRows(prisma, [
    ["roleBinding", { organizationId: organization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["project", { teamId: team.id }],
    ["organizationUser", { organizationId: organization.id }],
    ["user", { id: { in: orgUsers.map((orgUser) => orgUser.userId) } }],
    ["team", { id: team.id }],
    ["organization", { id: organization.id }],
  ]);
});

describe("Feature: Pull request usage REST API", () => {
  describe("given a shared (non-personal) workspace API key", () => {
    describe("when reading pull request usage", () => {
      /** @scenario "A shared-workspace key cannot read pull request usage" */
      it("refuses with the personal-workspace key required code", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: authHeaders({
            apiKey: sharedProject.apiKey,
            projectId: sharedProject.id,
          }),
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("personal_project_key_required");
      });
    });
  });

  describe("given a user-bound key that can view another user's personal workspace", () => {
    describe("when reading that workspace's pull request usage", () => {
      /** @scenario "A key cannot read another user's pull request usage" */
      it("refuses with the key mismatch code, not on permission", async () => {
        const res = await app.request(USAGE_PATH, {
          headers: authHeaders({
            apiKey: callerToken,
            projectId: otherUsersPersonalProjectId,
          }),
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("personal_usage_key_mismatch");
        // Nothing on the wire says whose workspace it is: that is the very
        // question the refusal exists to withhold.
        expect(JSON.stringify(body)).not.toContain(otherUsersPersonalProjectId);
      });
    });
  });

  describe("given the published API document", () => {
    /** The 200 answer's own property map, as the generated document holds it. */
    const answer = (): Record<
      string,
      {
        properties?: Record<string, unknown>;
        required?: string[];
        items?: { required?: string[] };
      }
    > => {
      const paths = (publishedSpec as unknown as { paths: Record<string, any> })
        .paths;
      return paths["/api/coding-agent/pull-request-usage"].get.responses["200"]
        .content["application/json"].schema.properties;
    };

    it("publishes the billed and not billed halves on every row and on the totals", () => {
      expect(answer().rows?.items?.required).toEqual(
        expect.arrayContaining(["billedCostUsd", "nonBilledCostUsd"]),
      );
      expect(answer().totals?.required).toEqual(
        expect.arrayContaining([
          "costUsd",
          "billedCostUsd",
          "nonBilledCostUsd",
        ]),
      );
    });

    /** @scenario "A shared project is named by the project the work ran in" */
    it("names each row's contributor rather than an agent-reported identity", () => {
      // A caller of this endpoint is building something that has to say WHO
      // the usage belongs to, which the agent's own id could never answer.
      expect(answer().rows?.items?.required).toEqual(
        expect.arrayContaining([
          "projectId",
          "projectSlug",
          "contributorLabel",
          "contributorIsProject",
        ]),
      );
      expect(answer().rows?.items?.required).not.toContain("userLabel");
    });

    it("publishes the per-model totals", () => {
      expect(answer().modelBreakdown?.items?.required).toEqual(
        expect.arrayContaining(["model", "totalTokens", "costUsd"]),
      );
    });

    it("keeps the pull request's own title out of the answer", () => {
      expect(Object.keys(answer().pullRequest?.properties ?? {})).not.toContain(
        "title",
      );
    });
  });
});
