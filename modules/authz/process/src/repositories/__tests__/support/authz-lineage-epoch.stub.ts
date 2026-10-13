import { vi } from "vitest";

import { AuthzLineageEpochRepository } from "../../authz-lineage-epoch.repository.ts";

export class StubAuthzLineageEpoch extends AuthzLineageEpochRepository {
  readonly findEpoch = vi.fn<(input: { organizationId: string }) => Promise<number | null>>(
    async () => 0,
  );
  readonly bump = vi.fn<(input: { organizationId: string }) => Promise<void>>(
    async () => undefined,
  );
}
