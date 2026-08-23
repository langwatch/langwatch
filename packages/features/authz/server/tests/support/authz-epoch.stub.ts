import { vi } from "vitest";
import { AuthzEpochPort } from "../../src/ports/authz-epoch.port";

export class StubAuthzEpoch extends AuthzEpochPort {
  readonly read = vi.fn<
    (input: { organizationId: string }) => Promise<number | null>
  >(async () => null);
  readonly bump = vi.fn<(input: { organizationId: string }) => Promise<void>>(
    async () => undefined,
  );
}
