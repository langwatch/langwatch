/**
 * Binds the project module's three declared namespaces to this process's
 * execution path. `project.*` reaches six deployment answers the module does
 * not own, and each is asked of the caller the runtime already resolved.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  homeTrpcTransport,
  integrationsChecksTrpcTransport,
  projectTrpcTransport,
  type IntegrationsChecksApi,
  type ProjectBrowserApi,
  type ProjectHomeApi,
} from "@langwatch/project-server";

/** The slices of the process context these namespaces read. */
export interface ProjectHostContext {
  actor(): Readonly<{ id: string }>;
  app: Readonly<{ projects: ProjectApi }>;
}

/**
 * The six answers `project.*` needs that the project does not own, each already
 * bound to the process's own graph. The caller is not among them: the runtime
 * resolves it, and the mount reads it off the request.
 */
export type ProjectBrowserPorts = Readonly<{
  encryptProjectSecret(value: string): string;
  probePermission(
    input: { userId: string } & Parameters<ProjectBrowserApi["probePermission"]>[0],
  ): Promise<boolean>;
  getFieldProtections(
    input: { userId: string; projectId: string },
  ): ReturnType<ProjectBrowserApi["getFieldProtections"]>;
  provisionLangyVirtualKey: ProjectBrowserApi["provisionLangyVirtualKey"];
  recordApiKeyRegenerated: ProjectBrowserApi["recordApiKeyRegenerated"];
  reportTopicClusteringFailure: ProjectBrowserApi["reportTopicClusteringFailure"];
}>;

/** Mounts `project.*` on the app process's tRPC root. */
export function createProjectTrpcRouter<TContext extends ProjectHostContext>(
  runtime: TrpcRuntime<TContext>,
  ports: ProjectBrowserPorts,
) {
  return runtime.mount(
    projectTrpcTransport,
    (ctx): ProjectBrowserApi => ({
      projects: () => ctx.app.projects,
      encryptProjectSecret: (value) => ports.encryptProjectSecret(value),
      probePermission: (input) => ports.probePermission({ userId: ctx.actor().id, ...input }),
      getFieldProtections: (input) =>
        ports.getFieldProtections({ userId: ctx.actor().id, projectId: input.projectId }),
      provisionLangyVirtualKey: (input) => ports.provisionLangyVirtualKey(input),
      recordApiKeyRegenerated: (entry) => ports.recordApiKeyRegenerated(entry),
      reportTopicClusteringFailure: (error, context) =>
        ports.reportTopicClusteringFailure(error, context),
    }),
  );
}

/** Mounts `home.*` on the app process's tRPC root. */
export function createHomeTrpcRouter<TContext extends object>(
  runtime: TrpcRuntime<TContext>,
  recentItems: ProjectHomeApi,
) {
  return runtime.mount(homeTrpcTransport, () => recentItems);
}

/** Mounts `integrationsChecks.*` on the app process's tRPC root. */
export function createIntegrationsChecksTrpcRouter<TContext extends object>(
  runtime: TrpcRuntime<TContext>,
  checklist: IntegrationsChecksApi,
) {
  return runtime.mount(integrationsChecksTrpcTransport, () => checklist);
}
