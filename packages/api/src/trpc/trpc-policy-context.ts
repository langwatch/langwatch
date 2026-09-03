import type { TrpcRequestLike, TrpcResponseLike } from "./trpc-policy-ports.js";

/**
 * The part of a process's tRPC context the policy spine reads directly.
 *
 * Everything the spine could reach through a service on the context arrives
 * as a port instead. What is left is the transport itself — the request and
 * response the log line and the audit row describe — plus the one flag the
 * fail-closed backstop exists to read.
 *
 * A process context is free to carry anything else; this is the minimum it
 * must satisfy for the spine to run on it.
 */
export interface TrpcPolicyContext {
  readonly req?: TrpcRequestLike | undefined;
  readonly res?: TrpcResponseLike | undefined;
  /**
   * Set by a declared authorization check, read by `enforcePermissionCheck`.
   * A procedure that reaches its resolver with this still false was never
   * checked, which is a refusal rather than a pass.
   */
  readonly permissionChecked: boolean;
}
