/**
 * The three type helpers the analytics vocabulary is written in.
 *
 * `platform/app/src/utils/types.ts` holds these next to nine unrelated ones and
 * is imported by two hundred modules that have nothing to do with a chart. What
 * the registry, the money formatter and the series type actually name is these
 * three, so they travel and the rest does not.
 */

/** An amount and the currency it is counted in, as a cost series reads it. */
export type Money = { amount: number; currency: "USD" | "EUR" };

/** The element type of an array, or the type itself when it is not one. */
export type Unpacked<T> = T extends (infer U)[] ? U : T;

/** Every optional key made required, all the way down. */
export type DeepRequired<T> = Required<{
  [P in keyof T]: T[P] extends object ? DeepRequired<T[P]> : Required<T[P]>;
}>;
