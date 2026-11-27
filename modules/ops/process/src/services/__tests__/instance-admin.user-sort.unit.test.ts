import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import type {
  AdminDataResult,
  AdminOperationInput,
  AdminOperationResult,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

import { InstanceAdminRepository } from "../../repositories/instance-admin.repository.ts";
import { AdminAuditSink } from "../impersonation.service.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { noOperators } from "./support/admin-doubles.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class RecordingRepository extends InstanceAdminRepository {
  readonly asked: AdminOperationInput[] = [];

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    this.asked.push(input);
    return { data: [], total: 0 };
  }

  async findUserById(): Promise<AdminDataResult> {
    return { data: null };
  }
}

class SilentAudit extends AdminAuditSink {
  async record(): Promise<void> {}
}

function usersSortedBy(field: string): AdminOperationInput {
  return {
    resource: "user",
    method: "getList",
    params: { sort: { field, order: "ASC" }, pagination: { page: 1, perPage: 25 } },
    actorId: "olive",
    req: { headers: {} },
  };
}

function instanceAdmin() {
  const repository = new RecordingRepository();
  const service = InstanceAdminService.create({
    operators: noOperators,
    repository,
    users: new TestUserApi(),
    accounts: {
      deactivateUser: () => Promise.reject(new Error("unreached")),
      changeUserEmail: () => Promise.reject(new Error("unreached")),
    },
    audit: new SilentAudit(),
  });
  return { service, repository };
}

describe("sorting the Back office users list", () => {
  describe("given an operator holding the view grant", () => {
    /** @scenario "The users list refuses a sort field it does not know" */
    it("refuses an unknown sort field with validation_error and never asks the repository", async () => {
      const { service, repository } = instanceAdmin();

      const refusal = await service.execute(usersSortedBy("passwordHash")).catch((e) => e);

      const handled = readHandledError(refusal);
      expect(handled?.code).toBe("validation_error");
      expect(handled?.meta).toMatchObject({ fieldErrors: { sort: [expect.any(String)] } });
      expect(repository.asked).toEqual([]);
    });

    it("passes a known column through to the repository", async () => {
      const { service, repository } = instanceAdmin();

      await service.execute(usersSortedBy("projects"));

      expect(repository.asked).toHaveLength(1);
      expect(repository.asked[0]?.params.sort).toEqual({ field: "projects", order: "ASC" });
    });
  });
});
