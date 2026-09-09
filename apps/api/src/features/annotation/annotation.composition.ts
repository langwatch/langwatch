/** Supplies existing process collaborators to the feature-owned annotation installer. */
import { annotationServer } from "@langwatch/annotation-server";
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { TraceApi, type TraceApi as TraceApiContract } from "@langwatch/trace-contract";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import {
  createAnnotationScoreTrpcRouter,
  createAnnotationTrpcRouter,
} from "./annotation-trpc.mount.ts";
import type { ComposedAnnotationFeature } from "./annotation.composition.types.ts";

/** The other features' services and directories the annotation surface reads. */
export type AnnotationPeers = Readonly<{
  projects: ProjectApiContract;
  organizations: OrganizationApiContract;
  users: UserApiContract;
  traces: TraceApiContract;
  permissions: AuthzApiContract;
}>;

/** Installs the annotation surfaces over this process's own graph. */
export async function installApiAnnotation(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: AnnotationPeers;
}): Promise<ComposedAnnotationFeature> {
  const { prisma } = options.infrastructure;
  const { projects, organizations, users, traces, permissions } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(ProjectApi, projects)
    .withProvided(OrganizationApi, organizations)
    .withProvided(UserApi, users)
    .withProvided(TraceApi, traces)
    .withProvided(AuthzApi, permissions)
    .withModule(annotationServer)
    .boot({ role: "api" });

  const app = runtime.module(annotationServer).provided;

  return {
    routers: (mount) => ({
      annotation: createAnnotationTrpcRouter(mount.runtime),
      annotationScore: createAnnotationScoreTrpcRouter(mount.runtime),
    }),
    app,
    restServices: { annotations: () => app },
  };
}
