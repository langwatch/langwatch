// Smoke-test v3 — DO NOT MERGE. Hook that returns JSX (react.md violation).
// Also: filename is .tsx, which the rule itself flags as a smell.

import React from "react";

export function useReturnsJsx() {
  return <div>nope</div>;
}
