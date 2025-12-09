// Global type augmentations to improve typings of Object.keys/entries/values
declare global {
  interface ObjectConstructor {
    /**
     * Strongly-typed keys that preserve keyof T as string keys
     */
    keys<T extends object>(o: T): Array<Extract<keyof T, string>>;

    /**
     * Strongly-typed entries that preserve key/value correlation for object literals
     */
    entries<T extends object>(
      o: T,
    ): Array<
      { [K in Extract<keyof T, string>]-?: [K, T[K]] }[Extract<keyof T, string>]
    >;

    /**
     * Strongly-typed values derived from keys of T
     */
    values<T extends object>(o: T): Array<T[Extract<keyof T, string>]>;
  }
}
