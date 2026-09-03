import { AwsClientProcessRuntime, OutboundProxyResolverPort } from "@langwatch/aws-client";
import { parseDataplaneS3RoutingTable } from "@langwatch/config";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
} from "@langwatch/stored-object-server/storage";
import type { TasksConfig } from "../config/tasks.config";

/** Matches the worker's own default (`worker.config.ts`); no shared constant exists for it. */
const DEFAULT_LOCAL_STORAGE_ROOT = "/var/lib/langwatch/objects";

/** One S3-compatible target: a bucket, and how to reach and authenticate to it. */
export type TasksProjectS3Target = Readonly<{
  bucket: string;
  endpoint?: string;
  region?: string;
  credentials?: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  }>;
}>;

/**
 * The per-project BYOC S3 lookup: project -> organization -> that
 * organization's own bucket. Read fresh on every resolution — projects move
 * between organizations, and a cached answer would keep writing to (and
 * reading from) the previous tenant's bucket.
 *
 * `getPrisma` is a thunk rather than a client so this port can be composed
 * before `TasksHost` finishes constructing; it refuses BY NAME
 * (`host.requirePrisma()`'s own error) if a lookup is ever attempted without
 * `DATABASE_URL` configured, rather than failing every task at boot.
 */
export class TasksProjectS3SourcePort extends StoredObjectProjectS3ConfigPort {
  constructor(
    private readonly getPrisma: () => Pick<PrismaClient, "project">,
    private readonly routes: ReadonlyMap<
      string,
      { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }
    >,
  ) {
    super();
  }

  async tryGet(projectId: string): Promise<TasksProjectS3Target | null> {
    if (this.routes.size === 0) return null;

    const project = await this.getPrisma().project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project) return null;

    const route = this.routes.get(project.team.organizationId);
    if (!route) return null;

    return {
      bucket: route.bucket,
      endpoint: route.endpoint,
      credentials: { accessKeyId: route.accessKeyId, secretAccessKey: route.secretAccessKey },
    };
  }
}

/** `apps/tasks` has no outbound proxy configuration of its own yet, matching `object-storage-migrate.composition.ts`. */
class TasksNoOutboundProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

/**
 * The object storage this process reads and writes through — the BYOC
 * routing and backend selection any task needing stored objects shares, so a
 * dataset backfill (or a future task) lands a project's bytes exactly where
 * the live application would.
 *
 * AZURE IS A NAMED ABSENCE: this process composes no Azure driver.
 * `destination.resolve()` still reads the real `STORED_OBJECTS_BACKEND`, so a
 * deployment actually running on Azure gets a clear refusal (thrown by
 * `StoredObjectDestinationPolicy` itself, naming the missing configuration)
 * the moment a project resolves to it — never a silent fall-through to the
 * local filesystem fallback.
 */
export type TasksObjectStorage = Readonly<{
  aws: AwsClientProcessRuntime;
  destination: StoredObjectDestinationPolicy;
  projects: TasksProjectS3SourcePort;
  globalS3?: TasksProjectS3Target;
}>;

export function createTasksObjectStorage(options: {
  config: TasksConfig;
  source: Readonly<Record<string, unknown>>;
  getPrisma: () => Pick<PrismaClient, "project">;
}): TasksObjectStorage {
  const { storage } = options.config;
  const aws = AwsClientProcessRuntime.create({ outboundProxy: new TasksNoOutboundProxy() });
  const routes = parseDataplaneS3RoutingTable(options.source).routes;
  const projects = new TasksProjectS3SourcePort(options.getPrisma, routes);

  const globalS3: TasksProjectS3Target | undefined = storage.s3.bucket?.trim()
    ? {
        bucket: storage.s3.bucket.trim(),
        ...(storage.s3.endpoint ? { endpoint: storage.s3.endpoint } : {}),
        ...(storage.s3.region ? { region: storage.s3.region } : {}),
        ...(storage.s3.accessKeyId && storage.s3.secretAccessKey
          ? {
              credentials: {
                accessKeyId: storage.s3.accessKeyId,
                secretAccessKey: storage.s3.secretAccessKey,
                ...(storage.s3.sessionToken ? { sessionToken: storage.s3.sessionToken } : {}),
              },
            }
          : {}),
      }
    : undefined;

  const destination = StoredObjectDestinationPolicy.create({
    selection: {
      backend: storage.backend ?? "s3",
      localFilesystemRoot: storage.localFilesystemRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
      ...(globalS3 ? { globalS3Bucket: globalS3.bucket } : {}),
    },
    projects,
  });

  return { aws, destination, projects, ...(globalS3 ? { globalS3 } : {}) };
}
