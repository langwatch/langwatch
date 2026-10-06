/**
 * @vitest-environment node
 * Trace's ingest source billing fold: the memory twin's contract. The Postgres twin runs the
 * same cases in prisma/__tests__/prisma.trace-ingest-source-billing.repository.integration.test.ts.
 */
import { describe } from "vitest";

import { MemoryTraceIngestSourceBillingRepository } from "../memory/memory.trace-ingest-source-billing.repository.ts";
import { describeIngestSourceBillingContract } from "./trace-ingest-source-billing.repository.contract.ts";

describe("given the memory trace ingest source billing repository", () => {
  describeIngestSourceBillingContract({
    create: () => MemoryTraceIngestSourceBillingRepository.create(),
    organizationId: () => "organization-1",
  });
});
