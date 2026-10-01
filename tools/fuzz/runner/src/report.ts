import type { Draft, FindingKind } from "./oracles.ts";
import type { TrailStep } from "./picker.ts";
import type { Oracle } from "./protocol.ts";

const ORACLE_OF: Record<FindingKind, Oracle> = {
  "page-error": "page-error",
  "console-error": "console-error",
  "server-error": "network-5xx",
  "client-error": "network-4xx",
  "request-failed": "network-5xx",
  "error-boundary": "error-boundary",
  "blank-screen": "blank",
  "not-found": "nav-404",
  hang: "hang",
};

export const oracleOf = (kind: FindingKind): Oracle => ORACLE_OF[kind];

/** signatureOf writes a draft's signature as the README groups them: `<oracle> :: <cause>`. */
export const signatureOf = (draft: Draft): string =>
  `${oracleOf(draft.kind)} :: ${draft.signature.slice(draft.kind.length + 1)}`;

/** routeLabel writes a router pattern the way the README shows one: `/[project]/traces`. */
export const routeLabel = (route: string): string => route.replaceAll(/:(\w+)\??/g, "[$1]");

/** trailLine is one step as a person reads it: `click button 'New'`. */
export const trailLine = (step: TrailStep): string => {
  switch (step.action) {
    case "open":
    case "reload":
      return `goto ${step.target}`;
    case "escape":
      return "press Escape";
    case "fill":
      return `fill ${step.target} ${step.value}`;
    default:
      return `${step.action} ${step.target}`;
  }
};
