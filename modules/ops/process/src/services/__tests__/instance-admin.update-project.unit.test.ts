import type { AdminOperationInput, AdminOperationResult } from "@langwatch/ops-contract";
import type { SetTraceSharingInput } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { InstanceAdminRepository } from "../../repositories/instance-admin.repository.ts";
import { AdminAuditSink } from "../impersonation.service.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class RecordingRepository extends InstanceAdminRepository {
  readonly writes: AdminOperationInput[] = [];

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    this.writes.push(input);
    return { data: { id: input.params.id, traceSharingEnabled: true } };
  }

  async findUserById(id: string): Promise<AdminOperationResult & { data: unknown }> {
    return { data: { id } };
  }
}

class SilentAudit extends AdminAuditSink {
  async record(): Promise<void> {}
}

function projectAdmin() {
  const repository = new RecordingRepository();
  const switches: SetTraceSharingInput[] = [];
  const service = InstanceAdminService.create({
    repository,
    users: new TestUserApi(),
    accounts: {
      deactivateUser: () => Promise.reject(new Error("unreached")),
      changeUserEmail: () => Promise.reject(new Error("unreached")),
    },
    projects: {
      setTraceSharing: async (input) => {
        switches.push(input);
      },
    },
    shares: { countTraceShares: async () => 3 },
    audit: new SilentAudit(),
  });
  const run = (
    method: AdminOperationInput["method"],
    params: AdminOperationInput["params"],
    resource: AdminOperationInput["resource"] = "project",
  ) =>
    service.execute({
      resource,
      method,
      params,
      actorId: "olive",
      req: { headers: {} },
    });

  return { repository, switches, run };
}

describe("InstanceAdminService project update", () => {
  describe("when the operator switches trace sharing off and keeps the links paused", () => {
    /** @scenario "Turning sharing off in Ops goes through project's sharing door" */
    it("asks project to switch it and keeps the field out of the generic write", async () => {
      const { repository, switches, run } = projectAdmin();

      await run("update", {
        id: "project-1",
        data: { traceSharingEnabled: false, revokeExistingLinks: false, name: "Renamed" },
      });

      expect(switches).toEqual([
        { projectId: "project-1", enabled: false, revokeExistingLinks: false, by: { id: "olive" } },
      ]);
      expect(repository.writes.map((write) => write.params.data)).toEqual([{ name: "Renamed" }]);
    });
  });

  describe("when the switch is the only change", () => {
    it("writes nothing generic, revokes by default and answers the stored row", async () => {
      const { repository, switches, run } = projectAdmin();

      await run("update", { id: "project-1", data: { traceSharingEnabled: false } });

      expect(switches[0]?.revokeExistingLinks).toBe(true);
      expect(repository.writes.map((write) => write.method)).toEqual(["getOne"]);
    });
  });

  describe("when the switch arrives anywhere but one project's update", () => {
    it.each([
      ["project", "updateMany", { ids: ["project-1"], data: { traceSharingEnabled: false } }],
      ["organization", "update", { id: "org-1", data: { traceSharingEnabled: false } }],
    ] as const)("refuses a %s %s and writes nothing", async (resource, method, params) => {
      const { repository, switches, run } = projectAdmin();

      await expect(run(method, params, resource)).rejects.toMatchObject({
        meta: { fieldErrors: { traceSharingEnabled: expect.any(Array) } },
      });
      expect(switches).toEqual([]);
      expect(repository.writes).toEqual([]);
    });
  });

  describe("when the edit drawer reads a project", () => {
    it("answers how many trace links it holds", async () => {
      const { run } = projectAdmin();

      const result = await run("getOne", { id: "project-1" });

      expect(result).toEqual({
        data: { id: "project-1", traceSharingEnabled: true, traceShareLinkCount: 3 },
      });
    });
  });
});
