/**
 * Ready-made ports for `trace-read-mappers.api.ts`: the two services this
 * package already owns, plus the data-privacy CONTRACT's portable constants
 * (never the data-privacy process — a module imports only a peer's contract).
 */
import {
  CONTENT_KEY_CATALOG,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  stripRolesFromChatArrayJson,
} from "@langwatch/data-privacy-contract";
import { buildDisplayInput, stringifySpanIO } from "@langwatch/trace-contract";

import {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "../../rules/trace-log-content-derivation.rules.ts";
import { TraceReadRedactionService } from "../../services/trace-read-redaction.service.ts";
import type { TraceDerivedAttrPrefixes, TraceReadMapperMembers } from "./trace-read-mappers.api.ts";

/** Backs only the header's drop banner, unwired — see the merge-traces-v2 handoff. */
async function getResolvedPolicyForProject(_input: {
  projectId: string;
}): Promise<{ categories: Record<string, { disposition: string }> }> {
  throw new Error("data-privacy policy resolution is not wired into traces.trpc.ts yet");
}

export const traceReadMapperPorts: TraceReadMapperMembers = {
  spanDisplay: { buildDisplayInput, stringifySpanIO },
  spanProtection: {
    applySpanProtections: TraceReadRedactionService.applySpanProtections,
    extractRedactionsFromAllSpanInputs:
      TraceReadRedactionService.extractRedactionsFromAllSpanInputs,
    extractRedactionsFromAllSpanOutputs:
      TraceReadRedactionService.extractRedactionsFromAllSpanOutputs,
    redactObject: TraceReadRedactionService.redactObject,
    applyDerivedTraceEventProtections: TraceReadRedactionService.applyDerivedTraceEventProtections,
  },
  contentPrivacy: {
    contentKeyCatalog: CONTENT_KEY_CATALOG,
    droppedMarkerAttribute: PRIVACY_DROPPED_MARKER_ATTR,
    piiIncompleteMarkerAttribute: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
    stripRolesFromChatArrayJson,
    getResolvedPolicyForProject,
  },
};

/** The prefixes ingest stamps on derived content, from this module's own rules. */
export const traceDerivedAttrPrefixes: TraceDerivedAttrPrefixes = {
  input: DERIVED_INPUT_ATTR_PREFIX,
  output: DERIVED_OUTPUT_ATTR_PREFIX,
};
