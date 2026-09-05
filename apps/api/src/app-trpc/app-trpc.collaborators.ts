/**
 * What the packaged tRPC record reaches that no feature composes for itself.
 *
 * It used to be a list of ports and application slices grouped into "halves",
 * each one a service no package held. Every one of those halves has since
 * dissolved into the feature that owns it, so what is left is the one thing a
 * record cannot be composed without and no single feature owns: the
 * APPLICATION.
 *
 * A request carries ONE application, and it arrives whole rather than one slice
 * per feature — a process that could hand a different slice to one surface than
 * to the one beside it would have two applications and no way to tell which
 * answered. Each slice on it is contributed by the feature that composed it, or
 * by that feature's named refusal, so a deployment missing a vertical still
 * mounts every namespace and says so at the call.
 *
 * A process that holds no application composes no record and says so by name —
 * see {@link ApiTrpcCollaboratorsAbsence}.
 */
import type { ApiTrpcFeatureApplication } from "./app-trpc.context";

export type ApiTrpcCollaborators = Readonly<{
  /**
   * The application slices every packaged surface reads off `ctx.app`.
   *
   * They arrive whole rather than one per feature: a request carries ONE
   * application, and a process that could hand a different slice to one
   * surface than to the one beside it would have two.
   */
  application: ApiTrpcFeatureApplication;
}>;

/**
 * Reports the composition decision a missing application would otherwise hide.
 *
 * Two reasons, and neither is a list of the individual capabilities: they are
 * one graph. A deployment holding the trace pipeline but not the sign-in
 * ceremony cannot serve `frontDoor`, and a record with `frontDoor` missing is
 * not a smaller record — it is a product a person cannot sign in to. The
 * absence is stated once, at the level a deployment can actually act on.
 */
export abstract class ApiTrpcCollaboratorsAbsence {
  abstract absent(reason: "no-collaborators" | "no-database"): void;
}
