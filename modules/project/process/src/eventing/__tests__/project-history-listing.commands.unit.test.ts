/**
 * @vitest-environment node
 * Spec: modules/project/specs/project-history-listing.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  RecordProjectFirstMessageListedCommand,
  RecordProjectPersonalOwnerListedCommand,
} from "../project-lifecycle.commands.ts";

const LISTED = {
  tenantId: "project_1",
  projectId: "project_1",
  organizationId: "org_acme",
  occurredAt: Date.UTC(2026, 10, 11, 12),
};

describe("project's listing commands", () => {
  /** @scenario "Re-running the project history listing sends the same facts again" */
  it("records a personal project's owner keyed by the project alone, so a rerun collapses", async () => {
    const record = (occurredAt: number) =>
      new RecordProjectPersonalOwnerListedCommand().handle({
        tenantId: createTenantId("project_1"),
        aggregateId: "project_1",
        type: RecordProjectPersonalOwnerListedCommand.schema.type,
        data: { ...LISTED, occurredAt, ownerUserId: "user_1" },
      });

    const [first] = await record(LISTED.occurredAt);
    const [rerun] = await record(LISTED.occurredAt + 60_000);

    expect(first?.type).toBe(PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE);
    expect(first?.aggregateId).toBe("project_1");
    expect(first?.data.ownerUserId).toBe("user_1");
    expect(first?.idempotencyKey).toBe("project_1:personal_owner_listed");
    expect(rerun?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  /** @scenario "Re-running the project history listing sends the same facts again" */
  it("records a project's first message keyed by the project alone, so a rerun collapses", async () => {
    const record = (occurredAt: number) =>
      new RecordProjectFirstMessageListedCommand().handle({
        tenantId: createTenantId("project_1"),
        aggregateId: "project_1",
        type: RecordProjectFirstMessageListedCommand.schema.type,
        data: { ...LISTED, occurredAt },
      });

    const [first] = await record(LISTED.occurredAt);
    const [rerun] = await record(LISTED.occurredAt + 60_000);

    expect(first?.type).toBe(PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE);
    expect(first?.aggregateId).toBe("project_1");
    expect(first?.idempotencyKey).toBe("project_1:first_message_listed");
    expect(rerun?.idempotencyKey).toBe(first?.idempotencyKey);
  });
});
