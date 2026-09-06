export type Money = { amount: number; currency: "USD" | "EUR" };

export type Unpacked<T> = T extends (infer U)[] ? U : T;

export type DeepRequired<T> = Required<{
  [P in keyof T]: T[P] extends object ? DeepRequired<T[P]> : Required<T[P]>;
}>;

export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;
