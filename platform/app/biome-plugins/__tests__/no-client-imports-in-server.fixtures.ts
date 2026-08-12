// Deliberate violations of no-client-imports-in-server.grit, plus the shapes
// that must NOT be flagged. Not compiled and not type-checked — the imports
// resolve to nothing. Its only job is to be linted.
//
// Files under biome-plugins/__tests__/ are outside Biome's scan scope, so
// pointing Biome at this path directly reports "paths ignored" and counts zero.
// It has to be copied into a backend tree to be measured, which is what
// `src/server/__tests__/noClientImportsInServer.plugin.unit.test.ts` does — into
// `src/server/.lint-fixtures/`, dot-prefixed so the transitive walker skips it.
//
// The path matters as much as the contents: the rule keys on `$filename`, so a
// copy landing anywhere other than a backend tree flags nothing and the fixture
// silently proves the opposite of what it claims.
//
// EXPECTED IN A BACKEND TREE: 6 diagnostics — the six marked SHOULD FLAG below,
// and none of the SHOULD NOT FLAG ones.

// --- SHOULD FLAG -----------------------------------------------------------

// A browser-only package, bound.
import { useState } from "react";
// A browser-only package, side-effect only: no clause, same resident cost.
import "@chakra-ui/react";
// A client component tree via the alias.
import { getSafeColumnName } from "~/components/datasets/utils/reservedColumns";
// A feature-local component tree — the depth that the first draft of the rule
// missed, and where two of the three real offenders actually live.
import { resolveCapabilityProgress } from "~/features/langy/components/capabilities/capabilityRegistry";
// The inline-type spelling. `type A` is erased but `useEffect` is a real value,
// so the statement is a value import and the `import type` negation must not
// swallow it.
import { type FC, useEffect } from "react";
// A re-export pulls the module exactly as hard as an import while reading as an
// export.
export { CustomGraph } from "~/components/analytics/CustomGraph";

// --- SHOULD NOT FLAG -------------------------------------------------------

// Type-only imports are erased at compile time and cannot pull a module at
// runtime. This is the exemption that makes the rule adoptable, and the one
// Biome's built-in noRestrictedImports cannot express.
import type { ReactNode } from "react";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { TraceWithGuardrail } from "~/components/messages/MessageCard";
export type { CustomGraphInput } from "~/components/analytics/CustomGraph";

// `reactflow` and `@react-email/*` both start with the banned word `react`.
// Anchoring the pattern on the closing quote is what keeps them out, and both
// are real: reactflow is the optimization-studio canvas, react-email renders
// the mail templates server-side.
import ReactFlow from "reactflow";
import { render } from "@react-email/render";

// Most of @opentelemetry is isomorphic and the server depends on it heavily.
// Only the three browser-bound entries are banned.
import { trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";

// Server-side LIFECYCLE hooks, not React hooks. Eleven files import these, and
// treating a `hooks/` segment as client code at any depth flags every one.
import { fireSignupNurturingCalls } from "~/../ee/billing/nurturing/hooks/signupIdentification";

// A filename that merely starts with the banned word — the segment has to be a
// directory.
import { helper } from "~/utils/componentsHelper";

export const fixtures = [
  useState,
  getSafeColumnName,
  resolveCapabilityProgress,
  useEffect,
  ReactFlow,
  render,
  trace,
  Resource,
  fireSignupNurturingCalls,
  helper,
] satisfies unknown[];
export type Unused = ReactNode | FilterParam | TraceWithGuardrail | FC;
