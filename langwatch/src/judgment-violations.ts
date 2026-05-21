// Smoke-test for issue #3754 — DO NOT MERGE.
// Expect CodeRabbit `path_instructions` (langwatch/src/**/*.{ts,tsx}) to flag:
//   - tRPC procedure declared without explicit `.input(z.object({...}))`
//   - React class component
//   - Service-layer importing from `~/components`

import React from "react";
import { router, publicProcedure } from "./trpc-stub";
// SERVICE-LAYER (langwatch/src/server/**) IMPORTING FROM ~/components — VIOLATION.
import { SomeButton } from "~/components/SomeButton";

// tRPC procedure with no .input(...) — VIOLATION.
export const noInputProcedure = router({
  ping: publicProcedure.query(() => ({ ok: true })),
});

// React class component — VIOLATION.
export class ClassComponentViolation extends React.Component {
  render() {
    return <SomeButton />;
  }
}
