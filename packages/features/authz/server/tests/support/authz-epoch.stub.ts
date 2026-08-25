import { vi } from "vitest";
import { AuthzEpochPort } from "../../src/ports/authz-epoch.port";

export class StubAuthzEpoch extends AuthzEpochPort {
  readonly tryRead = vi.fn<
    (input: { organizationId: string }) => Promise<number | null>
  >(async () => null);
  readonly bump = vi.fn<(input: { organizationId: string }) => Promise<void>>(
    async () => undefined,
  );
}
