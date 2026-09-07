export type TrpcApiDescriptor<F extends (...args: never[]) => object> = Readonly<{
  readonly protocol: "trpc";
  readonly router: F;
}>;

export function trpcApi<F extends (...args: never[]) => object>(input: {
  readonly router: F;
}): TrpcApiDescriptor<F> {
  return Object.freeze({ protocol: "trpc" as const, router: input.router });
}
