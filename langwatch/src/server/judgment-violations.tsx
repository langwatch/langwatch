// Smoke-test v3 for issue #3754 — DO NOT MERGE.
// Located under langwatch/src/server/ so the layering + tRPC + class-component
// rules' globs actually match (v2 had this at langwatch/src/judgment-violations.ts
// which was outside the service-layer glob).

import React from "react";
import { router, publicProcedure } from "./trpc-stub";
// SERVICE-LAYER importing UI — VIOLATION (service→component layering rule).
import { SomeButton } from "~/components/SomeButton";

// tRPC procedure missing .input(...) — VIOLATION.
export const noInputProcedure = router({
  ping: publicProcedure.query(() => ({ ok: true })),
});

// React class component — VIOLATION (class-component ban).
export class ClassComponentViolation extends React.Component {
  render() {
    return <SomeButton />;
  }
}
