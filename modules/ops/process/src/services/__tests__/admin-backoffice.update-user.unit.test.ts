import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AdminOperationInput, AdminOperationResult } from "@langwatch/ops-contract";
import type { Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { AdminBackofficeRepository } from "../../repositories/admin-backoffice.repository.ts";
import { AdminBackofficeService } from "../admin-backoffice.service.ts";
import { AdminAuditSink } from "../impersonation.service.ts";
import { backofficeOperator } from "./support/backoffice-doubles.ts";
import { TestUserApi } from "./support/test-user-api.ts";

class RecordingRepository extends AdminBackofficeRepository {
  constructor(private readonly log: unknown[]) {
    super();
  }

  async execute(input: AdminOperationInput): Promise<AdminOperationResult> {
    this.log.push(["repository.execute", input.params]);
    return { data: { id: input.params.id } };
  }

  async findUserById(id: string): Promise<AdminOperationResult & { data: unknown }> {
    this.log.push(["repository.findUserById", id]);
    return { data: { id } };
  }

  async setUserDeactivatedAt(id: string, value: Instant): Promise<void> {
    this.log.push(["repository.setUserDeactivatedAt", id, value.toString()]);
  }
}

class RecordingAudit extends AdminAuditSink {
  constructor(private readonly log: unknown[]) {
    super();
  }

  async record(input: { action: string; args: Record<string, unknown> }): Promise<void> {
    this.log.push(["audit.record", input.action, input.args]);
  }
}

async function updateUser(data: Record<string, unknown>) {
  const log: unknown[] = [];
  const service = AdminBackofficeService.create({
    repository: new RecordingRepository(log),
    users: new TestUserApi({
      reactivate: async ({ id }) => {
        log.push(["users.reactivate", id]);
        return { ...backofficeOperator, id };
      },
      deactivate: async ({ id }) => {
        log.push(["users.deactivate", id]);
        return { ...backofficeOperator, id };
      },
      findById: async ({ id }) => {
        log.push(["users.findById", id]);
        return { ...backofficeOperator, id, email: "same@example.com" };
      },
      updateProfile: async ({ id, email }) => {
        log.push(["users.updateProfile", id, email]);
        return { ...backofficeOperator, id, email: email ?? null };
      },
    }),
    auth: createApiFixture<AuthApi>({
      revokeAllBrowserSessions: async ({ userId }) => {
        log.push(["auth.revokeAllBrowserSessions", userId]);
      },
    }),
    audit: new RecordingAudit(log),
  });
  const result = await service.execute({
    resource: "user",
    method: "update",
    params: { id: "user-1", data },
    actorId: "olive",
    req: { headers: {} },
  });
  return { log, result };
}

describe("AdminBackofficeService user update", () => {
  it.each([
    ["reactivates on a null deactivation", { deactivatedAt: null }],
    ["reactivates on a blank deactivation and saves the rest", { deactivatedAt: "", name: "X" }],
    ["deactivates at a picked date", { deactivatedAt: "2026-01-02T03:04:05.000Z" }],
    ["deactivates without an unreadable picked date", { deactivatedAt: "not a date" }],
    ["passes an unrecognised deactivation value through", { deactivatedAt: 5 }],
    ["changes the email and revokes sessions", { email: " New@Example.com " }],
    ["keeps sessions when the email is unchanged", { email: "SAME@example.com" }],
    ["saves plain fields only", { name: "Only" }],
    ["combines every side effect", { deactivatedAt: null, email: "a@b.c", name: "N" }],
  ])("%s", async (_label, data) => {
    expect(await updateUser(data)).toMatchSnapshot();
  });
});

describe("AdminBackofficeService user writes past the user module", () => {
  /** @scenario "The Back office refuses user writes the user module does not serve" */
  it.each<[AdminOperationInput["method"], AdminOperationInput["params"]]>([
    ["updateMany", { ids: ["user-1"], data: { deactivatedAt: null } }],
    ["delete", { id: "user-1" }],
    ["deleteMany", { ids: ["user-1"] }],
  ])("refuses %s with validation_error and writes nothing", async (method, params) => {
    const log: unknown[] = [];
    const service = AdminBackofficeService.create({
      repository: new RecordingRepository(log),
      users: new TestUserApi({}),
      auth: createApiFixture<AuthApi>({}),
      audit: new RecordingAudit(log),
    });

    await expect(
      service.execute({ resource: "user", method, params, actorId: "olive", req: { headers: {} } }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(log).toEqual([]);
  });
});
