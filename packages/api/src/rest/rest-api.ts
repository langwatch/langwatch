import type { MountableRestApp } from "./types.ts";

export type RestApiDescriptor<F extends (...args: never[]) => MountableRestApp> = Readonly<{
  readonly protocol: "rest";
  readonly router: F;
}>;

export function restApi<F extends (...args: never[]) => MountableRestApp>(input: {
  readonly router: F;
}): RestApiDescriptor<F> {
  return Object.freeze({ protocol: "rest" as const, router: input.router });
}
