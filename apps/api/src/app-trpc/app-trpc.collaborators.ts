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
 * Reports the composition decision a missing application would hide. The first
 * two reasons are one graph; `unconverted-namespace` names ONE namespace the
 * record could not carry, which is that module's state, not this deployment's.
 */
export abstract class ApiTrpcCollaboratorsAbsence {
  abstract absent(
    reason: "no-collaborators" | "no-database" | "unconverted-namespace",
    namespace?: Readonly<{ namespace: string; reason: string }>,
  ): void;
}
