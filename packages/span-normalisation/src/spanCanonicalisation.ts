import {
  type AttributeCanonicaliser,
  canonicalLogRecordStore,
  canonicalSpanStore,
  type ExtractorContext,
  type LogExtractorContext,
  remainingAttributes,
  remainingEvents,
} from "./canonicalAttributes.ts";
import { parseJsonStringValues } from "./canonicalJson.ts";
import type {
  CanonicalAttributes,
  CanonicalEvent,
  CanonicalSpanContext,
} from "./canonicalTypes.ts";
import { ClaudeCodeCanonicaliserService } from "./claudeCodeCanonicaliser.ts";
import { CodexCanonicaliserService } from "./codexCanonicaliser.ts";
import type { CodexScopes } from "./codexSpan.ts";
import { CopilotCanonicaliserService } from "./copilotCanonicaliser.ts";
import { FallbackCanonicaliserService } from "./fallbackCanonicaliser.ts";
import { GenAICanonicaliserService } from "./genAiCanonicaliser.ts";
import { HaystackCanonicaliserService } from "./haystackCanonicaliser.ts";
import { LangWatchCanonicaliserService } from "./langwatchCanonicaliser.ts";
import { LegacyOtelCanonicaliserService } from "./legacyOtelCanonicaliser.ts";
import { LogfireCanonicaliserService } from "./logfireCanonicaliser.ts";
import { MastraCanonicaliserService } from "./mastraCanonicaliser.ts";
import { OpenInferenceCanonicaliserService } from "./openinferenceCanonicaliser.ts";
import { SpringAICanonicaliserService } from "./springAiCanonicaliser.ts";
import { StrandsCanonicaliserService } from "./strandsCanonicaliser.ts";
import { TraceloopCanonicaliserService } from "./traceloopCanonicaliser.ts";
import { VercelCanonicaliserService } from "./vercelCanonicaliser.ts";
import { VertexAdkCanonicaliserService } from "./vertexAdkCanonicaliser.ts";

/** The canonicalisers in the order they run; the order is load-bearing. */
export function orderedSpanCanonicalisers({
  codexScopes,
}: {
  codexScopes: CodexScopes;
}): readonly AttributeCanonicaliser[] {
  return [
    LangWatchCanonicaliserService.create(),
    GenAICanonicaliserService.create(),
    VertexAdkCanonicaliserService.create(),
    MastraCanonicaliserService.create(),
    OpenInferenceCanonicaliserService.create(),
    TraceloopCanonicaliserService.create(),
    VercelCanonicaliserService.create(),
    // Native CLI emitters can arrive as spans as well as log records.
    ClaudeCodeCanonicaliserService.create(),
    CodexCanonicaliserService.create({ scopes: codexScopes }),
    // Copilot adds its extras after GenAI establishes the standard attributes.
    CopilotCanonicaliserService.create(),
    SpringAICanonicaliserService.create(),
    StrandsCanonicaliserService.create(),
    LogfireCanonicaliserService.create(),
    HaystackCanonicaliserService.create(),
    LegacyOtelCanonicaliserService.create(),
    FallbackCanonicaliserService.create(),
  ];
}

export interface CanonicalisedSpanAttributes {
  attributes: CanonicalAttributes;
  events: CanonicalEvent[];
  appliedRules: string[];
}

/** Runs every canonicaliser over a span; unconsumed attributes survive under canonical ones. */
export function canonicaliseSpanAttributes({
  canonicalisers,
  spanAttributes,
  events,
  span,
}: {
  canonicalisers: readonly AttributeCanonicaliser[];
  spanAttributes: CanonicalAttributes;
  events: CanonicalEvent[];
  span: CanonicalSpanContext;
}): CanonicalisedSpanAttributes {
  const bag = canonicalSpanStore({ spanAttributes: parseJsonStringValues(spanAttributes), events });
  const out: ExtractorContext["out"] = {};
  const appliedRules: string[] = [];

  const recordRule = (ruleId: string) => appliedRules.push(ruleId);

  const setAttr = (key: string, value: unknown) => {
    if (value === null || value === void 0) {
      return;
    }

    out[key] = value;
  };

  const setAttrIfAbsent = (key: string, value: unknown) => {
    if (bag.attrs.has(key) || out[key] !== void 0) {
      return;
    }

    setAttr(key, value);
  };

  for (const canonicaliser of canonicalisers) {
    canonicaliser.apply({ bag, out, recordRule, span, setAttr, setAttrIfAbsent });
  }

  return {
    attributes: { ...remainingAttributes(bag.attrs), ...out },
    events: remainingEvents(bag.events),
    appliedRules,
  };
}

export interface CanonicalisedLogRecord {
  attributes: CanonicalAttributes;
  appliedRules: string[];
}

/** Runs every canonicaliser's log pass; only the canonical attributes are kept. */
export function canonicaliseLogRecord({
  canonicalisers,
  scopeName,
  body,
  attributes,
}: {
  canonicalisers: readonly AttributeCanonicaliser[];
  scopeName: string;
  body: string;
  attributes: CanonicalAttributes;
}): CanonicalisedLogRecord {
  const bag = canonicalLogRecordStore({
    scopeName,
    body,
    attributes: parseJsonStringValues(attributes),
  });
  const out: LogExtractorContext["out"] = {};
  const appliedRules: string[] = [];

  const recordRule = (ruleId: string) => appliedRules.push(ruleId);
  const setAttr = (key: string, value: unknown) => {
    if (value === null || value === void 0) {
      return;
    }

    out[key] = value;
  };
  const setAttrIfAbsent = (key: string, value: unknown) => {
    if (out[key] !== void 0) {
      return;
    }

    setAttr(key, value);
  };

  for (const canonicaliser of canonicalisers) {
    canonicaliser.applyLog?.({ bag, out, recordRule, setAttr, setAttrIfAbsent });
  }

  return { attributes: out, appliedRules };
}
