import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";
import type { Instant } from "@langwatch/time";

import type { GrantRowShape, RoleRowShape } from "./prisma/prisma.authz-grant.mapper.ts";

export type GrantProjectionWrite =
  | {
      kind: "grant.upsert";
      row: GrantRowShape;
      /** The membership lifetime the insert is fenced to, when it has one. */
      membershipStamp?: string;
      membershipBootstrap?: boolean;
    }
  | {
      kind: "grant.setRole";
      grantId: string;
      roleKey: string;
      occurredAt: Instant;
    }
  | {
      kind: "grant.revoke";
      grantId: string;
      reason: string | null;
      occurredAt: Instant;
    }
  | { kind: "role.upsert"; row: RoleRowShape }
  | {
      kind: "role.setPermissions";
      roleId: string;
      permissions: string[];
      occurredAt: Instant;
    }
  | { kind: "role.delete"; roleId: string; occurredAt: Instant };

/** Storage port for the guarded, state-setting projection writes. */
export abstract class AuthzGrantProjectionRepository implements AppendStore<GrantProjectionWrite> {
  abstract append(write: GrantProjectionWrite, context: ProjectionStoreContext): Promise<void>;

  bulkAppend?(writes: GrantProjectionWrite[], context: BulkAppendContext): Promise<void>;
}
