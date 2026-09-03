/**
 * The application and ports the shared transcript read is driven through.
 *
 * `TracesV2TrpcApi.readCodingAgentTranscript` takes the application it reads
 * through and the ports this package does not own. Both are assembled here
 * from the REAL implementations the API process wires (`readPorts()` in
 * `apps/api/src/app/api-trace-read-stack.composition.ts`), so the log
 * visibility gate, the coding-agent join and the transcript derivation all run
 * for real — the only doubles are the two stores the trace is read from.
 */

import { vi } from "vitest";
import {
  CONTENT_KEY_CATALOG,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
} from "@langwatch/data-privacy-contract";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { buildDisplayInput, stringifySpanIO } from "@langwatch/trace-contract";
import { TraceApp } from "../../../../app/trace.app";
import {
  enrichCodingAgentSpansFromLogs,
  enrichSingleSpanWithClaudeLogContent,
  isCodingAgentShapedSpan,
  mapSummaryRowsToClaudeRefs,
} from "../../../../services/claude-code-log-enrichment.service";
import type { ClaudeSpanRef } from "../../../../services/claude-code-span-enrichment.service";
import {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "../../../../services/trace-log-content-derivation.service";
import {
  applyDerivedTraceEventProtections,
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
  extractRedactionsFromAllSpanOutputs,
  redactObject,
} from "../../../../services/trace-read-redaction.service";
import type { TracesV2ReadPorts } from "../../traces-v2.api";

/** One of the two stores the read is driven from. */
export type TranscriptStoreMock = ReturnType<
  typeof vi.fn<(...args: unknown[]) => Promise<unknown[]>>
>;

/**
 * The two stores a transcript read stands on, as mocked boundaries.
 *
 * A real `TraceApp` stands over them rather than an object shaped like the
 * reader's own calls: `readSpans` is where the tenant key and the visibility
 * cutoff are decided, so a double of it would assert nothing about the mapping
 * the production read depends on.
 */
export function createTranscriptApp(codingAgents: CodingAgentService): {
  app: TraceApp;
  getSpansByTraceId: TranscriptStoreMock;
  getLogsByTraceId: TranscriptStoreMock;
} {
  const getSpansByTraceId = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const getLogsByTraceId = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
  const app = TraceApp.create({
    traces: {
      spans: { getSpansByTraceId },
      logRecords: { getLogsByTraceId },
      canonicalisation: undefined,
    },
    codingAgents,
  } as unknown as Parameters<typeof TraceApp.create>[0]);
  return { app, getSpansByTraceId, getLogsByTraceId };
}

/**
 * The read ports, real everywhere the package owns the implementation.
 *
 * `getVisibilityCutoffMs` answers "no window": the plan's visibility cutoff is
 * a SEPARATE gate resolved by the process, and leaving it on would mask the
 * data-privacy decisions these suites measure.
 */
export function createTranscriptReadPorts(): TracesV2ReadPorts {
  return {
    getVisibilityCutoffMs: async () => null,
    derivedAttrPrefixes: {
      input: DERIVED_INPUT_ATTR_PREFIX,
      output: DERIVED_OUTPUT_ATTR_PREFIX,
    },
    mappers: {
      spanDisplay: { buildDisplayInput, stringifySpanIO },
      spanProtection: {
        applySpanProtections,
        extractRedactionsFromAllSpanInputs,
        extractRedactionsFromAllSpanOutputs,
        redactObject,
        applyDerivedTraceEventProtections,
      },
      contentPrivacy: {
        contentKeyCatalog: CONTENT_KEY_CATALOG,
        droppedMarkerAttribute: PRIVACY_DROPPED_MARKER_ATTR,
        piiIncompleteMarkerAttribute: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
        // Both members below are reached only through the SPAN mapping, and a
        // transcript read of a trace with no stored spans never gets there.
        // Throwing says so; a silent stub would let a broken span pass for a
        // redacted one.
        stripRolesFromChatArrayJson: () => {
          throw new Error("the chat-turn stripper is not reached by a span-less transcript read");
        },
        getResolvedPolicyForProject: () => {
          throw new Error("the resolved data-privacy policy is not read by a transcript read");
        },
      },
    },
    codingAgentEnrichment: {
      isCodingAgentShapedSpan,
      enrichSpansFromLogs: (input) => enrichCodingAgentSpansFromLogs(input),
      enrichSingleSpanWithLogContent: (input) =>
        enrichSingleSpanWithClaudeLogContent({
          ...input,
          modelCallRefs: input.modelCallRefs as ClaudeSpanRef[],
        }),
      mapSummaryRowsToRefs: mapSummaryRowsToClaudeRefs,
    },
  };
}
