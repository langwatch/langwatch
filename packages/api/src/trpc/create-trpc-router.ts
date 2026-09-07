export type TrpcTransportDescriptor<F extends (...args: never[]) => object> = Readonly<{
  readonly protocol: "trpc";
  readonly router: F;
}>;

export function createTrpcRouter<F extends (...args: never[]) => object>(
  router: F,
): TrpcTransportDescriptor<F> {
  return Object.freeze({ protocol: "trpc" as const, router });
}
