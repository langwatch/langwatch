/** Replaces specified number-typed fields with Date for DateTime64 write path. */
export type WithDateWrites<T, K extends keyof T> = {
  [P in keyof T]: P extends K
    ? T[P] extends number
      ? Date
      : T[P] extends number | null
        ? Date | null
        : T[P] extends number[]
          ? Date[]
          : T[P]
    : T[P];
};
