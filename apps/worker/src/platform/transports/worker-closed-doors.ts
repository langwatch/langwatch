/**
 * The worker opens no HTTP doors.
 *
 * Module transport declarations are role-independent — the same feature list
 * the api installs is installed here — and `mountDeclaredTransports` rightly
 * refuses a DECLARED protocol the process opened no door for, because on the
 * api that refusal is what names a forgotten host. This process's answer is a
 * door that is deliberately CLOSED rather than missing: every declaration
 * mounts onto it, nothing is ever served from it, and anything that reaches
 * for a mounted surface anyway gets a refusal naming the role, not an
 * `undefined`.
 *
 * The api's real doors are `apiRestHosts` and `ApiTrpcHost`
 * (apps/api/src/app-trpc/api-trpc.host.ts); this file is their worker-role
 * counterpart, shaped by the same `FeatureTransportHosts` seam.
 */
import type { FeatureTransportHosts } from "@langwatch/runtime-composition";

/** What a closed door hands back for every mount: a named refusal, deferred. */
export type ClosedDoorMount = Readonly<{
  serve(): never;
}>;

const CLOSED = (feature: string, protocol: string): ClosedDoorMount => ({
  serve(): never {
    throw new Error(
      `The worker mounted feature "${feature}"'s ${protocol} transport on a closed door: ` +
        "this role serves no HTTP surface. Serve it from the api process instead.",
    );
  },
});

/**
 * Both protocols' doors, closed. Pass to `createApp(...).withTransports(...)`
 * in any worker composition that installs transport-declaring modules.
 */
export function workerClosedDoors(): FeatureTransportHosts<ClosedDoorMount, ClosedDoorMount> {
  return {
    rest: { mount: () => CLOSED("a REST family", "REST") },
    trpc: { mount: () => CLOSED("a tRPC namespace", "tRPC") },
  };
}
