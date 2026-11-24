/** The A2A target registry's writes: scoping, save-time refusals, audit and the change feed. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AppendGatewayAuditInput } from "../repositories/gateway-audit.repository.ts";
import { MemoryGatewayA2aTargetRepository } from "../repositories/memory/memory.gateway-a2a-target.repository.ts";
import { MemoryGatewayChangeEventsRepository } from "../repositories/memory/memory.gateway-change-event.repository.ts";
import { a2aTargetToDto } from "../rules/gateway-a2a-target.rules.ts";
import {
  FOREIGN_PROJECT_ID,
  a2aTargetBase as base,
  a2aTargetService as service,
  sealedA2aTargetRepository,
} from "./support/a2a-target.fixture.ts";

const validationFailureSchema = z.object({
  issues: z.array(z.object({ path: z.array(z.unknown()), code: z.string() })),
});

/** The validation failure a write raised: each issue's path and code, never its prose. */
async function issuesOf(write: Promise<unknown>): Promise<{ path: unknown[]; code: string }[]> {
  const error: unknown = await write.then(
    () => null,
    (caught: unknown) => caught,
  );
  return validationFailureSchema.parse(error).issues.map(({ path, code }) => ({ path, code }));
}

describe("GatewayA2aTargetService", () => {
  /** @scenario "a project admin manages the project's own targets" */
  it("lets a project manage only its own targets", async () => {
    const targets = service();
    const own = await targets.create({ ...base, projectId: "p1", name: "billing" });
    const other = await targets.create({ ...base, projectId: "p2", name: "billing" });
    const orgWide = await targets.create({ ...base, projectId: null, name: "shared" });
    const scope = { organizationId: base.organizationId, projectId: "p1" };

    expect((await targets.listForProject(scope)).map((t) => t.id)).toEqual([own.id]);
    await expect(
      targets.updateForProject({ ...scope, id: own.id, agentName: "Renamed", actorUserId: "u1" }),
    ).resolves.toMatchObject({ agentName: "Renamed" });
    await expect(
      targets.setBlockedForProject({
        ...scope,
        id: own.id,
        blocked: true,
        blockReason: "incident",
        actorUserId: "u1",
      }),
    ).resolves.toMatchObject({ blocked: true, blockReason: "incident" });
    for (const foreign of [other, orgWide]) {
      await expect(
        targets.updateForProject({ ...scope, id: foreign.id, agentName: "x", actorUserId: "u1" }),
      ).rejects.toMatchObject({ code: "gateway_a2a_target_not_found" });
      await expect(
        targets.archiveForProject({ ...scope, id: foreign.id, actorUserId: "u1" }),
      ).rejects.toMatchObject({ code: "gateway_a2a_target_not_found" });
    }
    await targets.archiveForProject({ ...scope, id: own.id, actorUserId: "u1" });
    expect(await targets.listForProject(scope)).toEqual([]);
  });

  it("refuses a second target with the same name in the same scope", async () => {
    const targets = service();
    await targets.create({ ...base, projectId: "p1", name: "billing" });
    await expect(
      targets.create({ ...base, projectId: "p1", name: "billing" }),
    ).rejects.toMatchObject({ code: "gateway_a2a_target_name_taken" });
    await expect(
      targets.create({ ...base, projectId: null, name: "billing" }),
    ).resolves.toMatchObject({ projectId: null });
  });

  describe("when the target names a project of another organization", () => {
    it("refuses with the scope mismatch code and stores, announces and audits nothing", async () => {
      const changeEvents = MemoryGatewayChangeEventsRepository.create();
      const rows: AppendGatewayAuditInput[] = [];
      const targets = service({
        changeEvents,
        auditLog: {
          append: async (row) => {
            rows.push(row);
          },
        },
      });

      await expect(
        targets.create({ ...base, projectId: FOREIGN_PROJECT_ID, name: "billing" }),
      ).rejects.toMatchObject({ code: "gateway_scope_org_mismatch" });
      expect(await targets.list(base.organizationId)).toEqual([]);
      expect((await changeEvents.since(base.organizationId, 0n)).events).toEqual([]);
      expect(rows).toEqual([]);
    });
  });

  it("checks a new name without unsealing any target's headers", async () => {
    const targets = service({ repository: sealedA2aTargetRepository() });

    await expect(
      targets.create({ ...base, projectId: null, name: "billing" }),
    ).resolves.toMatchObject({ name: "billing" });
  });

  /** @scenario "listed targets show their header names, never their values" */
  it("lists an organization's and a project's targets with header names and no values", async () => {
    const targets = service();
    await targets.create({
      ...base,
      projectId: "p1",
      name: "billing",
      upstreamHeaders: { "X-Agent-Tenant": "tenant-s3cret", "X-Agent-Region": "region-s3cret" },
    });
    await targets.create({ ...base, projectId: "p1", name: "search" });

    const listed = [
      ...(await targets.list(base.organizationId)),
      ...(await targets.listForProject({ organizationId: base.organizationId, projectId: "p1" })),
    ].map(a2aTargetToDto);

    expect(listed.map((target) => [target.name, target.upstreamHeaderNames])).toEqual([
      ["billing", ["X-Agent-Region", "X-Agent-Tenant"]],
      ["search", []],
      ["billing", ["X-Agent-Region", "X-Agent-Tenant"]],
      ["search", []],
    ]);
    expect(JSON.stringify(listed)).not.toContain("s3cret");
  });

  /** @scenario "a target URL that holds credentials is refused at save time" */
  it("refuses credentials inside a target URL without echoing them", async () => {
    for (const field of ["upstreamUrl", "cardUrl"] as const) {
      const error: unknown = await service()
        .create({
          ...base,
          projectId: null,
          name: "billing",
          [field]: "https://agent:hunter2@billing.acme.test/a2a",
        })
        .catch((caught: unknown) => caught);

      expect(await issuesOf(Promise.reject(error))).toEqual([{ path: [field], code: "custom" }]);
      expect(String(error)).not.toContain("hunter2");
      expect(JSON.stringify(error)).not.toContain("hunter2");
    }
  });

  /** @scenario "the target's saved upstream headers never follow its upstream to a new origin" */
  it("refuses to carry saved upstream headers to a new upstream origin", async () => {
    const targets = service();
    const created = await targets.create({
      ...base,
      projectId: null,
      name: "billing",
      upstreamHeaders: { "X-Token": "s3cret" },
    });
    const edit = { id: created.id, organizationId: "org_1", actorUserId: "u1" };

    for (const upstreamUrl of ["https://collector.evil.test/a2a", "http://billing.acme.test/a2a"]) {
      await expect(targets.update({ ...edit, upstreamUrl })).rejects.toMatchObject({
        code: "gateway_a2a_target_headers_need_replacing",
      });
    }
    await expect(
      targets.update({ ...edit, upstreamUrl: "https://billing.acme.test/v2/a2a" }),
    ).resolves.toMatchObject({ upstreamHeaders: { "X-Token": "s3cret" } });
    await expect(
      targets.update({
        ...edit,
        upstreamUrl: "https://agents.acme.test/a2a",
        upstreamHeaders: { "X-Token": "replaced" },
      }),
    ).resolves.toMatchObject({ upstreamUrl: "https://agents.acme.test/a2a" });
  });

  describe("when headers are saved between an upstream move's read and its write", () => {
    /** @scenario "the target's saved upstream headers never follow its upstream to a new origin" */
    it("refuses the move and keeps the headers on their origin", async () => {
      const repository = MemoryGatewayA2aTargetRepository.create();
      const targets = service({ repository });
      const created = await targets.create({ ...base, projectId: null, name: "billing" });
      const ref = { id: created.id, organizationId: base.organizationId };
      const findById = repository.findById.bind(repository);
      let interleaved = false;
      repository.findById = async (input) => {
        const snapshot = await findById(input);
        if (!interleaved) {
          interleaved = true;
          await targets.update({
            ...ref,
            upstreamHeaders: { "X-Token": "s3cret" },
            actorUserId: "u2",
          });
        }
        return snapshot;
      };

      await expect(
        targets.update({
          ...ref,
          upstreamUrl: "https://collector.evil.test/a2a",
          actorUserId: "u1",
        }),
      ).rejects.toMatchObject({ code: "gateway_a2a_target_headers_need_replacing" });
      expect(await findById(ref)).toMatchObject({
        upstreamUrl: base.upstreamUrl,
        upstreamHeaders: { "X-Token": "s3cret" },
      });
    });
  });

  /** @scenario "every A2A target write is audited without header values" */
  it("writes a gateway audit row for every write, with header names but never values", async () => {
    const rows: AppendGatewayAuditInput[] = [];
    const targets = service({
      auditLog: {
        append: async (row) => {
          rows.push(row);
        },
      },
    });
    const created = await targets.create({
      ...base,
      projectId: "p1",
      name: "billing",
      upstreamHeaders: { "X-Token": "s3cret" },
    });
    const ref = { id: created.id, organizationId: "org_1" };
    await targets.update({ ...ref, agentName: "Renamed", actorUserId: "u2" });
    await targets.setBlocked({ ...ref, blocked: true, blockReason: "incident", actorUserId: "u3" });
    await targets.setBlocked({ ...ref, blocked: false, blockReason: null, actorUserId: "u3" });
    await targets.archive({ ...ref, actorUserId: "u4" });

    expect(rows.map((row) => [row.action, row.actorUserId, row.targetKind, row.projectId])).toEqual(
      [
        ["gateway.a2a_target.created", "user_1", "a2a_target", "p1"],
        ["gateway.a2a_target.updated", "u2", "a2a_target", "p1"],
        ["gateway.a2a_target.blocked", "u3", "a2a_target", "p1"],
        ["gateway.a2a_target.unblocked", "u3", "a2a_target", "p1"],
        ["gateway.a2a_target.archived", "u4", "a2a_target", "p1"],
      ],
    );
    expect(rows.every((row) => row.targetId === created.id)).toBe(true);
    expect(rows[1]?.before).toMatchObject({
      agentName: "Billing agent",
      upstreamHeaderNames: ["X-Token"],
    });
    expect(rows[1]?.after).toMatchObject({ agentName: "Renamed" });
    expect(JSON.stringify(rows)).not.toContain("s3cret");
  });

  it("refuses names that cannot be a path segment", async () => {
    expect(
      await issuesOf(service().create({ ...base, projectId: null, name: "Bad/Name" })),
    ).toEqual([{ path: ["name"], code: "invalid_format" }]);
  });

  it("refuses an upstream that is not http or https", async () => {
    const issues = await issuesOf(
      service().create({ ...base, projectId: null, name: "x", upstreamUrl: "file:///etc/passwd" }),
    );

    expect(issues.map((issue) => issue.path)).toContainEqual(["upstreamUrl"]);
    expect(issues.every((issue) => issue.path[0] === "upstreamUrl")).toBe(true);
  });

  it("clears the reason when a target is unblocked", async () => {
    const targets = service();
    const created = await targets.create({ ...base, projectId: null, name: "billing" });
    await targets.setBlocked({
      id: created.id,
      organizationId: "org_1",
      blocked: true,
      blockReason: "x",
      actorUserId: "u1",
    });
    const unblocked = await targets.setBlocked({
      id: created.id,
      organizationId: "org_1",
      blocked: false,
      blockReason: "x",
      actorUserId: "u1",
    });
    expect(unblocked).toMatchObject({ blocked: false, blockReason: null });
  });

  it("appends a change event on every write so gateways refetch their bundles", async () => {
    const changeEvents = MemoryGatewayChangeEventsRepository.create();
    const targets = service({ changeEvents });
    const created = await targets.create({ ...base, projectId: "p1", name: "billing" });
    await targets.setBlocked({
      id: created.id,
      organizationId: base.organizationId,
      blocked: true,
      blockReason: "incident",
      actorUserId: base.actorUserId,
    });
    await targets.archive({
      id: created.id,
      organizationId: base.organizationId,
      actorUserId: base.actorUserId,
    });

    const { events } = await changeEvents.since(base.organizationId, 0n);
    expect(events.map((event) => [event.kind, event.projectId])).toEqual([
      ["A2A_TARGET_CREATED", "p1"],
      ["A2A_TARGET_UPDATED", "p1"],
      ["A2A_TARGET_DELETED", "p1"],
    ]);
  });

  it("stores one target when two creates with the same name race", async () => {
    const targets = service();
    const results = await Promise.allSettled([
      targets.create({ ...base, projectId: null, name: "billing" }),
      targets.create({ ...base, projectId: null, name: "billing" }),
    ]);

    expect(results.map((result) => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "gateway_a2a_target_name_taken" },
    });
  });
});
