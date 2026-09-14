import { AwsClientProcessRuntime, OutboundProxyResolver } from "@langwatch/aws-client";
import { parseDataplaneS3RoutingTable } from "@langwatch/config";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  StoredObjectDestinationPolicyAdapter,
  StoredObjectProjectS3Config,
} from "@langwatch/stored-object-server";
import type { TasksConfig } from "../config/tasks.config.ts";

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

// Per-project BYOC S3 lookup. Read fresh each time; projects move between orgs.
export class TasksProjectS3Source extends StoredObjectProjectS3Config {
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

/** No outbound proxy configuration yet (matches object-storage-migrate). */
class TasksNoOutboundProxy extends OutboundProxyResolver {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

// Object storage this process reads/writes through. BYOC routing.
export type TasksObjectStorage = Readonly<{
  aws: AwsClientProcessRuntime;
  destination: StoredObjectDestinationPolicyAdapter;
  projects: TasksProjectS3Source;
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
  const projects = new TasksProjectS3Source(options.getPrisma, routes);

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

  const destination = StoredObjectDestinationPolicyAdapter.create({
    selection: {
      backend: storage.backend ?? "s3",
      localFilesystemRoot: storage.localFilesystemRoot ?? DEFAULT_LOCAL_STORAGE_ROOT,
      ...(globalS3 ? { globalS3Bucket: globalS3.bucket } : {}),
    },
    projects,
  });

  return { aws, destination, projects, ...(globalS3 ? { globalS3 } : {}) };
}
