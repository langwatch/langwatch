/** The cases every trace ingest source billing repository answers alike. */
import { expect, it } from "vitest";

import type { TraceIngestSourceBillingRepository } from "../trace-ingest-source-billing.repository.ts";

export function describeIngestSourceBillingContract({
  create,
  organizationId,
}: {
  create: () => TraceIngestSourceBillingRepository;
  organizationId: () => string;
}): void {
  it("answers absence for a source nothing was recorded for", async () => {
    await expect(
      create().find({ organizationId: organizationId(), sourceType: "claude_code" }),
    ).resolves.toBeNull();
  });

  it("keeps the newer fact whatever order the facts arrive in", async () => {
    const repository = create();
    const key = { organizationId: organizationId(), sourceType: "codex" };

    await repository.recordIfNewer({ ...key, billed: false, recordedAtMs: 1_000 });
    await repository.recordIfNewer({ ...key, billed: true, recordedAtMs: 3_000 });
    await repository.recordIfNewer({ ...key, billed: false, recordedAtMs: 2_000 });
    await repository.recordIfNewer({ ...key, billed: false, recordedAtMs: 3_000 });

    await expect(repository.find(key)).resolves.toEqual({ billed: true, recordedAtMs: 3_000 });
  });

  it("keeps one row per source within an organization", async () => {
    const repository = create();
    const org = organizationId();

    await repository.recordIfNewer({
      organizationId: org,
      sourceType: "claude_code",
      billed: true,
      recordedAtMs: 10,
    });
    await repository.recordIfNewer({
      organizationId: org,
      sourceType: "cursor",
      billed: false,
      recordedAtMs: 20,
    });

    await expect(
      repository.find({ organizationId: org, sourceType: "claude_code" }),
    ).resolves.toEqual({
      billed: true,
      recordedAtMs: 10,
    });
    await expect(repository.find({ organizationId: org, sourceType: "cursor" })).resolves.toEqual({
      billed: false,
      recordedAtMs: 20,
    });
  });
}
