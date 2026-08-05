/**
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * The refusal path for `POST /api/experiments/:slug/comparison`, driven through
 * the real Hono app rather than asserted off the route registry.
 *
 * Declaring `evaluations:create` and enforcing it are two different claims. The
 * grain test next door pins the declaration; this one presents a key that holds
 * `evaluations:view` and nothing more, and proves the request is refused before
 * it can touch the experiment.
 */
import { generate } from "@langwatch/ksuid";
import {
  ExperimentType,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { getTestProject } from "~/utils/testUtils";

describe("POST /api/experiments/:slug/comparison permission enforcement", () => {
  const suffix = nanoid(8);
  const slug = `comparison-permission-${suffix}`;

  let projectId: string;
  let organizationId: string;
  let experimentId: string;
  let userId: string;
  let apiKeyId: string;
  let readOnlyToken: string;
  let request: (path: string, init?: RequestInit) => Promise<Response>;

  beforeAll(async () => {
    // Only the experiments family, not the composed router. This asserts one
    // route's behaviour, and pulling in every other family costs minutes of
    // transform for modules nothing here touches.
    const { app } = await import("~/server/routes/experiments-v3");
    request = async (path, init) =>
      await app.fetch(new Request(`http://localhost${path}`, init));

    const project = await getTestProject("comparison-permission");
    projectId = project.id;
    const team = await prisma.team.findFirstOrThrow({
      where: { id: project.teamId },
    });
    organizationId = team.organizationId;

    const user = await prisma.user.create({
      data: {
        name: "Comparison Read-Only User",
        email: `comparison-readonly-${suffix}@example.com`,
      },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: team.organizationId,
        role: OrganizationUserRole.ADMIN,
      },
    });
    // The user is bound broadly on purpose. What makes the credential read-only
    // is the key's own restricted permission list, which is how a least-
    // privilege token is actually minted: a capable owner issuing a narrow one.
    // The ceiling is the intersection, so the refusal below comes from the key.
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: team.organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.PROJECT,
        scopeId: projectId,
      },
    });

    const created = await ApiKeyService.create(prisma).create({
      name: `comparison-readonly-${suffix}`,
      userId,
      createdByUserId: userId,
      organizationId: team.organizationId,
      permissionMode: "restricted",
      permissions: ["evaluations:view"],
      bindings: [
        {
          role: TeamUserRole.CUSTOM,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: projectId,
        },
      ],
    });
    readOnlyToken = created.token;
    apiKeyId = created.apiKey.id;

    const experiment = await prisma.experiment.create({
      data: {
        projectId,
        name: "Comparison Permission Test",
        slug,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: {
          name: "Comparison Permission Test",
          datasets: [
            {
              id: "dataset-1",
              name: "Test Dataset",
              type: "inline",
              columns: [{ id: "input", name: "input", type: "string" }],
            },
          ],
          activeDatasetId: "dataset-1",
          targets: [],
          evaluators: [],
        },
      },
    });
    experimentId = experiment.id;
  });

  // Ordered child-before-parent, and routed through the guarded helper: every
  // id here is assigned inside `beforeAll`, so any of them is undefined exactly
  // when setup failed, and a raw `deleteMany` would then drop the key from the
  // filter and sweep the shared database (#6219).
  afterAll(() =>
    cleanupTestRows(prisma, [
      ["experiment", { id: experimentId, projectId }],
      // Role bindings reference the key, so they go before it.
      ["roleBinding", { organizationId, userId }],
      ["roleBinding", { organizationId, apiKeyId }],
      ["apiKey", { id: apiKeyId, organizationId }],
      ["organizationUser", { userId, organizationId }],
      ["user", { id: userId }],
    ]),
  );

  const attach = (headers: Record<string, string>) =>
    request(`/api/experiments/${slug}/comparison`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        variants: [
          { kind: "prompt", handle: "draft-v1" },
          { kind: "prompt", handle: "draft-v2" },
        ],
      }),
    });

  describe("when the key holds evaluations:view and nothing more", () => {
    /** @scenario "Rejects a request from a key that can only read evaluations" */
    it("refuses the attach and leaves the experiment untouched", async () => {
      const response = await attach({
        Authorization: `Bearer ${readOnlyToken}`,
        "X-Project-Id": projectId,
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("api_key_permission_denied");

      const stored = await prisma.experiment.findFirstOrThrow({
        where: { id: experimentId, projectId },
      });
      expect((stored.workbenchState as { targets: unknown[] }).targets).toEqual(
        [],
      );
    });
  });

  describe("when no credential is presented at all", () => {
    it("refuses with an unauthenticated status rather than a permission one", async () => {
      const response = await attach({});

      expect(response.status).toBe(401);
    });

    it("answers the missing credential before it looks at the body", async () => {
      const response = await request(`/api/experiments/${slug}/comparison`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants: [] }),
      });

      // A schema rejection here would describe the request shape to a caller
      // who never proved they may see it.
      expect(response.status).toBe(401);
    });
  });

  /** The project's own key, which clears the ceiling this route asks for. */
  const authorized = async () => ({
    "Content-Type": "application/json",
    "X-Auth-Token": (
      await prisma.project.findFirstOrThrow({ where: { id: projectId } })
    ).apiKey,
  });

  describe("when the body is not JSON at all", () => {
    it("separates a document that never parsed from one that failed the schema", async () => {
      const response = await request(`/api/experiments/${slug}/comparison`, {
        method: "POST",
        headers: await authorized(),
        body: "{not valid json",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("malformed_request");
    });
  });

  describe("when more variants are sent than a comparison can judge", () => {
    it("refuses the request rather than resolving each one in turn", async () => {
      const response = await request(`/api/experiments/${slug}/comparison`, {
        method: "POST",
        headers: await authorized(),
        body: JSON.stringify({
          variants: Array.from({ length: 11 }, (_, i) => ({
            kind: "prompt",
            handle: `draft-v${i}`,
          })),
        }),
      });

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
      expect(body.fields).toContain("variants");
    });
  });
});
