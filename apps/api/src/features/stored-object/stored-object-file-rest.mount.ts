/**
 * Binds `/api/files` to this process's own byte door: the dual-credential
 * verifier a browser and a project key share, the person's project permission,
 * and the deployment's one fixed-window counter.
 */
import {
  createRestRuntime,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  storedObjectFileRest,
  type FilesProjectPermissionCheck,
  type FilesRateLimiter,
  type StoredObjectFileApi,
  type StoredObjectFileCaller,
} from "@langwatch/stored-object-server";
import type { MiddlewareHandler } from "hono";

import type { ApiDualAuthVariables } from "../../app/api-dual-credential-auth.ts";

/** The two reads the byte door makes, as this process composed them. */
export type StoredObjectFileReads = Readonly<{
  resolveOwner: StoredObjectFileApi["resolveOwner"];
  readById: StoredObjectFileApi["readById"];
}>;

/** What `/api/files` reaches that it does not own. */
export type StoredObjectFileRestPorts = Readonly<{
  storedObjects: () => StoredObjectFileReads;
  /** Accepts a project API key OR a browser session, and refuses both at once. */
  dualAuth: MiddlewareHandler;
  requireProjectPermission: FilesProjectPermissionCheck;
  rateLimit: FilesRateLimiter;
  /** The process's own error envelope, which this family answers in. */
  errors: RestErrorHandler;
}>;

/**
 * The verifier's answer, kept beside the request: the family asks who the
 * caller is from its declaration, which holds a `Request` and no context.
 */
type ByteCallers = WeakMap<Request, StoredObjectFileCaller>;

/** `/api/files/:projectId/:id` and its id-only twin, bound to one process. */
export function mountStoredObjectFileRest(ports: StoredObjectFileRestPorts): MountableRestApp {
  const callers: ByteCallers = new WeakMap();

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("A stored-object byte read asks no permission of its credential.");
      },
      // The family's own door, already opened by the verifier below. A project
      // key resolves a PROJECT rather than a person, which is why only the
      // session branch names an actor.
      identify: ({ request }) => {
        const userId = callerOf(callers, request).userId;

        return { actor: userId ? ({ type: "user", id: userId } as const) : null, scope: null };
      },
    },
  });

  return runtime.mount(storedObjectFileRest.router(), {
    app: () => fileApi({ ports, callers }),
    credential: "session",
    onError: ports.errors,
    middleware: [ports.dualAuth, remember(callers)],
  });
}

/** Keeps the verifier's answer against the request the declaration is handed. */
function remember(callers: ByteCallers): MiddlewareHandler<{ Variables: ApiDualAuthVariables }> {
  return async (context, next) => {
    callers.set(context.req.raw, {
      apiKeyProjectId: context.get("apiKeyProjectId"),
      userId: context.get("userId"),
      apiKeyCeiling: context.get("apiKeyCeiling"),
    });

    await next();
  };
}

/** Whatever the verifier left; the family names the refusal for an empty one. */
function callerOf(callers: ByteCallers, request: Request): StoredObjectFileCaller {
  return callers.get(request) ?? {};
}

/** The five things the byte door asks, over this process's own graph. */
function fileApi({
  ports,
  callers,
}: {
  ports: StoredObjectFileRestPorts;
  callers: ByteCallers;
}): StoredObjectFileApi {
  return {
    identify: async ({ request }) => callerOf(callers, request),
    countRead: (input) => ports.rateLimit(input),
    requireProjectPermission: (input) => ports.requireProjectPermission(input),
    resolveOwner: (input) => ports.storedObjects().resolveOwner(input),
    readById: (input) => ports.storedObjects().readById(input),
  };
}
