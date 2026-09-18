import { vi } from "vitest";
import { AuthzEpochRepository } from "../../authz-epoch.repository.ts";

export class StubAuthzEpoch extends AuthzEpochRepository {
  readonly findEpoch = vi.fn<(input: { organizationId: string }) => Promise<number | null>>(
    async () => null,
  );
  readonly bump = vi.fn<(input: { organizationId: string }) => Promise<void>>(
    async () => undefined,
  );
}
