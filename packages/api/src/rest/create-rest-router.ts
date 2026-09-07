import type { MountableRestApp } from "./types.ts";

export type RestTransportDescriptor<F extends (...args: never[]) => MountableRestApp> = Readonly<{
  readonly protocol: "rest";
  readonly router: F;
}>;

export function createRestRouter<F extends (...args: never[]) => MountableRestApp>(
  router: F,
): RestTransportDescriptor<F> {
  return Object.freeze({ protocol: "rest" as const, router });
}
