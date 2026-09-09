/**
 * What the packaged tRPC record reaches that no feature composes for itself. It used to
 * be a list of ports and application slices grouped into "halves", each one a service no
 * package held.
 */
import type { ApiTrpcFeatureApplication } from "./app-trpc.context.ts";

export type ApiTrpcCollaborators = Readonly<{
  /**
   * The application slices every packaged surface reads off `ctx.app`. They arrive whole
   * rather than one per feature: a request carries ONE application, and a process that
   * could hand a different slice to one surface than to the one beside it would have two.
   */
  application: ApiTrpcFeatureApplication;
}>;

/**
 * Reports the composition decision a missing application would otherwise hide. Three
 * reasons, and none is a list of the individual capabilities: they are one graph.
 * `unconverted-transports` is the state of the record itself, not of this deployment.
 */
export abstract class ApiTrpcCollaboratorsAbsence {
  abstract absent(reason: "no-collaborators" | "no-database" | "unconverted-transports"): void;
}
