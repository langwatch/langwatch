/**
 * Binds `/api/files` to this process's byte door: the dual-credential verifier
 * a browser and a project key share is the runtime's own, and this file names
 * the two reads and the person's project permission the family asks about.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import {
  storedObjectFileRest,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
  type StoredObjectFileApi,
} from "@langwatch/stored-object-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** The two reads the byte door makes, as this process composed them. */
export type StoredObjectFileReads = Readonly<{
  resolveOwner: StoredObjectFileApi["resolveOwner"];
  readById: StoredObjectFileApi["readById"];
}>;

/** What `/api/files` reaches that it does not own. */
export type StoredObjectFileRestPorts = Readonly<{
  storedObjects: () => StoredObjectFileReads;
  requireProjectPermission: FilesProjectPermissionCheck;
  rateLimit: FilesRateLimiter;
}>;

/** `/api/files/:projectId/:id` and its id-only twin, bound to one process. */
export function mountStoredObjectFileRest(
  runtime: ApiRestRuntime,
  ports: StoredObjectFileRestPorts,
): readonly MountableRestApp[] {
  return [runtime.mount(storedObjectFileRest.router(), () => fileApi({ runtime, ports }))];
}

/** The five things the byte door asks, over this process's own graph. */
function fileApi({
  runtime,
  ports,
}: {
  runtime: ApiRestRuntime;
  ports: StoredObjectFileRestPorts;
}): StoredObjectFileApi {
  return {
    // Whatever the runtime's verifier left; the family names the refusal for
    // an empty one itself.
    identify: async ({ request }) => runtime.browserCallerOf(request),
    countRead: (input) => ports.rateLimit(input),
    requireProjectPermission: (input) => ports.requireProjectPermission(input),
    resolveOwner: (input) => ports.storedObjects().resolveOwner(input),
    readById: (input) => ports.storedObjects().readById(input),
  };
}
