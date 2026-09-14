/**
 * Worker opens no HTTP doors. Declarations mount onto a deliberately closed door (throws refusal
 * naming the role, not undefined) to be consistent with feature declarations.
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
