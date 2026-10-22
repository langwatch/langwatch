import { useState } from "preact/hooks";

const SENTINEL = Symbol.for("react.memo_cache_sentinel");

/** The React Compiler's memo cache on Preact: one array per component instance, kept across renders. */
export function c(size: number): unknown[] {
  return useState(() => Array.from({ length: size }, () => SENTINEL))[0];
}
