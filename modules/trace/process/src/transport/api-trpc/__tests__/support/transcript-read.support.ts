// Real implementations everywhere; only the two stores are mocked.

import { createApiFixture } from "@langwatch/api-fixture";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import {
  CONTENT_KEY_CATALOG,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
} from "@langwatch/data-privacy-contract";
import { buildDisplayInput, stringifySpanIO } from "@langwatch/trace-contract";
import { vi } from "vitest";

import { createTraceAppHarness } from "../../../../app/__tests__/support/trace-app.harness.ts";
import type { TraceLogRecordReader, TracesSpanReader } from "../../../../app/trace.app.ts";
import {
  DERIVED_INPUT_ATTR_PREFIX,
  DERIVED_OUTPUT_ATTR_PREFIX,
} from "../../../../rules/trace-log-content-derivation.rules.ts";
import {
  applyDerivedTraceEventProtections,
  applySpanProtections,
  extractRedactionsFromAllSpanInputs,
  extractRedactionsFromAllSpanOutputs,
  redactObject,
} from "../../../../rules/trace-read-redaction.rules.ts";
import type { TracesReadMembers } from "../../../../services/trace-transcript-read.service.ts";
import type { TraceViewerProtectionService } from "../../../../services/trace-viewer-protection.service.ts";

// Real TraceApp required: readSpans decides tenant key and visibility cutoff.
export function createTranscriptApp(
  codingAgents: CodingAgentApi,
  protections?: Partial<TraceViewerProtectionService>,
) {
  const getSpansByTraceId = vi.fn<TracesSpanReader["getSpansByTraceId"]>();
  const getLogsByTraceId = vi.fn<TraceLogRecordReader["getLogsByTraceId"]>();
  const app = createTraceAppHarness({
    codingAgents,
    ...(protections
      ? { protections: createApiFixture<TraceViewerProtectionService>(protections, "protections") }
      : {}),
    traces: {
      spans: createApiFixture<TracesSpanReader>({ getSpansByTraceId }, "spans"),
      logRecords: createApiFixture<TraceLogRecordReader>({ getLogsByTraceId }, "logRecords"),
      canonicalisation: undefined,
    },
  });
  return { app, getSpansByTraceId, getLogsByTraceId };
}

/**
 * The read ports, real everywhere the package owns the implementation.
 * `getVisibilityWindow` answers "no window": that cutoff is a SEPARATE
 * gate resolved by the process, and leaving it on would mask what these suites measure.
 */
export function createTranscriptReadPorts(): TracesReadMembers {
  return {
    getVisibilityWindow: async () => ({ visibilityCutoffMs: null }),
    derivedAttrPrefixes: {
      input: DERIVED_INPUT_ATTR_PREFIX,
      output: DERIVED_OUTPUT_ATTR_PREFIX,
    },
    mappers: {
      spanDisplay: { buildDisplayInput, stringifySpanIO },
      spanProtection: {
        applySpanProtections: applySpanProtections,
        extractRedactionsFromAllSpanInputs: extractRedactionsFromAllSpanInputs,
        extractRedactionsFromAllSpanOutputs: extractRedactionsFromAllSpanOutputs,
        redactObject: redactObject,
        applyDerivedTraceEventProtections: applyDerivedTraceEventProtections,
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
  };
}
