/** The memory twin of the A2A target store: a write replaces exactly the row it read. */
import { describe, expect, it } from "vitest";

import { a2aTargetBase as base } from "../../../__tests__/support/a2a-target.fixture.ts";
import { MemoryGatewayA2aTargetRepository } from "../memory.gateway-a2a-target.repository.ts";

describe("MemoryGatewayA2aTargetRepository", () => {
  it("keeps an archive that lands while an update is in flight", async () => {
    const repository = MemoryGatewayA2aTargetRepository.create();
    const created = await repository.create({ ...base, projectId: null, name: "billing" });
    const target = { id: created.id, organizationId: base.organizationId };

    await Promise.all([
      repository.update({ ...target, agentName: "Renamed", actorUserId: base.actorUserId }),
      repository.archive(target),
    ]);

    expect(await repository.findById(target)).toBeNull();
    expect(await repository.findAll(base.organizationId)).toEqual([]);
  });
});
