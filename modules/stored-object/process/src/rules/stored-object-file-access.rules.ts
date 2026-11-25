import type { Readable } from "node:stream";

import { HandledError } from "@langwatch/handled-error";
import type { StoredObjectFileRow } from "@langwatch/stored-object-contract";

/** A probe's answer before the purpose decides the gate and is dropped. */
export type StoredObjectProbe =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "available" | "missing"; mediaType: string; purpose: string }>;

/** The contract's byte read, narrowed to the Node stream this process's byte backends hand over. */
export type StoredObjectFileStreamRead =
  | { row: StoredObjectFileRow; stream: Readable }
  | { row: StoredObjectFileRow; status: "missing" };

/**
 * Who asked: a project key, pinned to its own project and reading every file
 * there as on main, or a signed-in person held to their project permissions.
 */
export type StoredObjectFileCaller = Readonly<{
  apiKeyProjectId?: string | undefined;
  userId?: string | undefined;
}>;

/** One file-door read: who asked, which object, and the owner and filename the URL named. */
export type StoredObjectFileReadInput = Readonly<{
  caller: StoredObjectFileCaller;
  id: string;
  claimedProjectId?: string | undefined;
  requestedFilename?: string | undefined;
}>;

/** One object's bytes as the file door serves them: safe media type, length and headers. */
export type StoredObjectFileBytes = Readonly<{
  stream: Readable;
  mediaType: string;
  byteLength: number;
  headers: Readonly<Record<string, string>>;
}>;

/** The codes the permission check raises when it refuses the caller. */
const DENIAL_CODES: ReadonlySet<string> = new Set([
  "project_permission_denied",
  "lite_member_restricted",
  "developer_seat_restricted",
  // The ADR-092 engine's denial: without it here the engine's 403 would surface as a 500.
  "permission_denied",
]);

/**
 * True only for the denial shapes the permission check documents. Anything
 * else (a dropped connection, a Prisma fault) must bubble up as a 5xx.
 */
export function isPermissionDenial(err: unknown): boolean {
  return HandledError.isHandled(err) && DENIAL_CODES.has(err.code);
}
