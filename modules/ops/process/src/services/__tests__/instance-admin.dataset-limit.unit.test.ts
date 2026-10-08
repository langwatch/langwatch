import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import {
  type AdminOperationInput,
  ORGANIZATION_DATASET_ATTACHMENT_MAX_MB,
  ORGANIZATION_DATASET_ATTACHMENT_MAX_MB_REFUSAL,
  ORGANIZATION_DATASET_ATTACHMENT_MIN_MB,
} from "@langwatch/ops-contract";
import {
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
} from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { MemoryInstanceAdminRepository } from "../../repositories/memory/memory.instance-admin.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { AdminAuditSink } from "../impersonation.service.ts";
import { InstanceAdminService } from "../instance-admin.service.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const MiB = 1024 * 1024;

class RecordingAudit extends AdminAuditSink {
  readonly entries: { userId: string; action: string; args: Record<string, unknown> }[] = [];

  async record(entry: {
    userId: string;
    action: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    this.entries.push({ userId: entry.userId, action: entry.action, args: entry.args });
  }
}

function organizationEdit(data: Record<string, unknown>): AdminOperationInput {
  return {
    resource: "organization",
    method: "update",
    params: { id: "org-acme", data },
    actorId: "olive",
    req: { headers: {} },
  };
}

async function instanceAdmin() {
  const repository = MemoryInstanceAdminRepository.create({ store: MemoryOpsStore.create() });
  const audit = new RecordingAudit();
  const service = InstanceAdminService.create({ repository, users: new TestUserApi(), audit });
  await repository.execute({
    resource: "organization",
    method: "create",
    params: { data: { id: "org-acme", name: "Acme", datasetAttachmentMaxMb: null } },
    actorId: "olive",
    req: { headers: {} },
  });
  const stored = async () => {
    const { data } = await repository.execute({
      resource: "organization",
      method: "getOne",
      params: { id: "org-acme" },
      actorId: "olive",
      req: { headers: {} },
    });
    return (data as { datasetAttachmentMaxMb: unknown }).datasetAttachmentMaxMb;
  };

  return { service, audit, stored };
}

describe("the Back office's max dataset file size", () => {
  describe("given an operator holding the manage grant", () => {
    describe("when they set an organization's max dataset file size to 100 MB", () => {
      /** @scenario "An operator sets an organization's max dataset file size in the Back office" */
      it("stores 100 MB with an audit entry, and stores no limit once cleared", async () => {
        const { service, audit, stored } = await instanceAdmin();

        await service.execute(organizationEdit({ datasetAttachmentMaxMb: 100 }));

        expect(await stored()).toBe(100);
        expect(audit.entries).toEqual([
          {
            userId: "olive",
            action: "admin/update/organization",
            args: { id: "org-acme", data: { datasetAttachmentMaxMb: 100 } },
          },
        ]);

        await service.execute(organizationEdit({ datasetAttachmentMaxMb: null }));

        expect(await stored()).toBeNull();
      });

      it("accepts both ends of the range", async () => {
        const { service, stored } = await instanceAdmin();

        await service.execute(organizationEdit({ datasetAttachmentMaxMb: 20 }));
        expect(await stored()).toBe(20);
        await service.execute(organizationEdit({ datasetAttachmentMaxMb: 1024 }));
        expect(await stored()).toBe(1024);
      });
    });

    describe("when they write a max dataset file size outside the allowed range", () => {
      /** @scenario "The Back office refuses a max dataset file size outside the allowed range" */
      it.each([19, 1025, 0, -5, 20.5, "100", true])(
        "refuses %j with validation_error on the field, writing and auditing nothing",
        async (value) => {
          const { service, audit, stored } = await instanceAdmin();

          const refusal = await service
            .execute(organizationEdit({ name: "Renamed", datasetAttachmentMaxMb: value }))
            .then(
              () => null,
              (error: unknown) => readHandledError(error),
            );

          expect(refusal?.code).toBe("validation_error");
          expect(refusal?.meta).toMatchObject({
            fieldErrors: {
              datasetAttachmentMaxMb: [ORGANIZATION_DATASET_ATTACHMENT_MAX_MB_REFUSAL],
            },
          });
          expect(await stored()).toBeNull();
          expect(audit.entries).toEqual([]);
        },
      );
    });
  });

  describe("given the range the back office accepts", () => {
    it("matches the default and the ceiling the dataset bounds are derived from", () => {
      expect(ORGANIZATION_DATASET_ATTACHMENT_MIN_MB * MiB).toBe(
        DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
      );
      expect(ORGANIZATION_DATASET_ATTACHMENT_MAX_MB * MiB).toBe(
        DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
      );
    });
  });
});
