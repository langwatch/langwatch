/**
 * The request context every packaged tRPC surface on this process is resolved
 * against.
 *
 * `createAppTrpcFeatures` constrains its context to the INTERSECTION of every
 * mounted feature's own context type, and each of those names one slice of the
 * host application plus, for a few, the authenticated session. This module is
 * that intersection written down once, so the process has a single answer to
 * "what must a request carry for the whole record to be mountable" instead of
 * discovering it one compile error at a time.
 *
 * Two things are deliberately NOT here:
 *
 *  - the process-wide capabilities the ports reach (a mailer, a model gateway,
 *    the trace pipeline). Those are composition, not request state, and they
 *    arrive as {@link ApiTrpcCollaborators}. The platform app carried them on
 *    the request context because that is where its service locator lived; a
 *    process that composes its own graph has no reason to re-resolve them per
 *    call.
 *  - anything a feature package does not read. A slice nothing names is a slice
 *    nothing can depend on, which is what keeps this list honest.
 */
import type { AnalyticsApp } from "@langwatch/analytics-server";
import type { AnnotationApp } from "@langwatch/annotation-server";
import type { ApiKeyApp } from "@langwatch/api-key-server";
import type { DashboardApp } from "@langwatch/dashboard-server";
import type { ExperimentApp } from "@langwatch/experiment-server";
import type { OrganizationApp } from "@langwatch/organization-server";
import type { PresenceService } from "@langwatch/presence-contract";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { UserApp } from "@langwatch/user-server";
import type { WorkflowApp } from "@langwatch/workflow-server";

/**
 * The application slices the mounted surfaces read off `ctx.app`.
 *
 * `broadcast` serves two features on purpose: the export relay asks only for
 * `getTenantEmitter`, which is the narrower half of the presence emitter, so
 * one channel answers both rather than two channels answering the same
 * question differently.
 */
export type ApiTrpcFeatureApplication = Readonly<{
  analytics: AnalyticsApp;
  annotations: AnnotationApp;
  apiKeys: ApiKeyApp;
  broadcast: PresenceEmitterPort;
  dashboard: DashboardApp;
  /**
   * The evaluation command surface. `reportEvaluation` is a pipeline command
   * rather than a service method, which is why the feature names it
   * structurally and so does this.
   */
  evaluations: Readonly<{ reportEvaluation(data: never): Promise<unknown> }>;
  experiments: ExperimentApp;
  /** Whether the caller is a platform operator, as the ops surface asks it. */
  ops: Readonly<{ isAdmin(identity: never): boolean }>;
  organizations: OrganizationApp;
  presence: PresenceService;
  users: UserApp;
  workflows: WorkflowApp;
  /**
   * The deployment answers `publicEnv` reads directly. One field today, and it
   * is configuration rather than a service, so it rides the application slice
   * the transport already receives instead of a second channel.
   */
  config: Readonly<{ opsSidebarEmails?: readonly string[] | undefined }>;
}>;

/**
 * The signed-in person, as the surfaces that render them read it.
 *
 * Wider than the actor the authorization chain uses, because presence draws
 * the person's name and picture and the ops surface reads the impersonator —
 * both from the session rather than from the payload, so a client cannot claim
 * to be somebody else.
 */
export type ApiTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  /**
   * The real administrator when one is acting as this person.
   *
   * Optional but never `null`: two of the surfaces that read it describe the
   * "nobody is impersonating" state as an ABSENT key and two describe it as
   * `null`, and only the absent spelling satisfies both. One spelling is also
   * the safer one to converge on — a `null` that slips past a truthiness check
   * reads as an impersonator object.
   */
  impersonator?: ApiTrpcSessionUser;
}>;

export type ApiTrpcSession = Readonly<{
  user: ApiTrpcSessionUser;
  /** The browser session's own id, where the deployment tracks one. */
  sessionId?: string;
}>;

/**
 * The context the process-owned ports read, as they read it.
 *
 * The packaged port signatures type their `ctx` against the FEATURE's own
 * context — the narrow slice that feature declared — because a port is written
 * for a host the package cannot name. A host implementing one reads its own
 * context back out, which is what this alias is for: one written statement of
 * what the API process's ports may rely on, rather than a cast per entry.
 */
export type ApiTrpcPortsContext = Readonly<{
  actor(): Readonly<{ id: string }>;
  session?: ApiTrpcSession | null;
  app: ApiTrpcFeatureApplication;
}>;
