/**
 * The three type helpers the analytics vocabulary is written in, pulled out
 * of `platform/app/src/utils/types.ts` (200+ unrelated importers) since only
 * these three — registry, money formatter, series type — need to travel.
 */

/** An amount and the currency it is counted in, as a cost series reads it. */
export type Money = { amount: number; currency: "USD" | "EUR" };

/** The element type of an array, or the type itself when it is not one. */
export type Unpacked<T> = T extends (infer U)[] ? U : T;

/** Every optional key made required, all the way down. */
export type DeepRequired<T> = Required<{
  [P in keyof T]: T[P] extends object ? DeepRequired<T[P]> : Required<T[P]>;
}>;
