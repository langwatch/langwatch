export type Money = { amount: number; currency: "USD" | "EUR" };

export type Unpacked<T> = T extends (infer U)[] ? U : T;

export type DeepRequired<T> = Required<{
  [P in keyof T]: T[P] extends object ? DeepRequired<T[P]> : Required<T[P]>;
}>;
