/**
 * Building the data an evaluator sees: the trace or thread mappings resolved to values, with
 * the server-only sources (formatted spans) filled in here rather than in the browser.
 */

import {
  DEFAULT_MAPPINGS,
  migrateLegacyMappings,
  mapTraceToDatasetEntry,
  type MappingState,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
} from "@langwatch/dataset-contract";
import { EvaluatorNotFoundError, TraceNotEvaluatableError } from "@langwatch/evaluation-contract";
import {
  AVAILABLE_EVALUATORS,
  isCodeEvaluatorCheckType,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import { EvaluatorConfigError } from "@langwatch/model-provider-contract";
import { type Trace } from "@langwatch/trace-contract";

import type { EvaluationTraceProtections } from "../app/evaluation.members.ts";
import {
  hasThreadMappings,
  resolveThreadMappingsIntoData,
} from "../rules/evaluation-thread-mapping-service.rules.ts";
import {
  findUnavailability,
  unavailableEvaluatorMessage,
} from "../rules/evaluator-availability-service.rules.ts";
import type { DataForEvaluation, EvaluationExecutionDeps } from "./evaluation-execution.service.ts";

// Evaluations need full access to trace data — no user-facing redaction.
const INTERNAL_PROTECTIONS: EvaluationTraceProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

export class EvaluationDataService {
  static create(deps: EvaluationExecutionDeps): EvaluationDataService {
    return new EvaluationDataService(deps);
  }

  private constructor(private readonly deps: EvaluationExecutionDeps) {}

  private async fillServerOnlyTraceSources({
    mapping,
    mappedData,
    trace,
  }: {
    mapping: MappingState["mapping"];
    mappedData: Record<string, unknown>;
    trace: Trace;
  }): Promise<void> {
    for (const [field, config] of Object.entries(mapping)) {
      if (
        !("source" in config) ||
        !(SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(config.source)
      ) {
        continue;
      }

      if (config.source === "formatted_trace") {
        mappedData[field] = await this.deps.spanDigest.format(trace.spans ?? []);
      }
    }
  }

  async buildDataForEvaluation(params: {
    evaluatorType: string;
    trace: Trace;
    mappings: MappingState | null;
    isThreadLevel: boolean;
    projectId: string;
  }): Promise<DataForEvaluation> {
    const { evaluatorType, trace, mappings, isThreadLevel, projectId } = params;

    let data: Record<string, unknown>;

    if (isThreadLevel) {
      data = await this.buildThreadData(projectId, trace, mappings);
    } else {
      const mappedData = mapTraceFields(trace, mappings ?? DEFAULT_MAPPINGS);
      if (!mappedData) {
        throw new TraceNotEvaluatableError(trace.trace_id);
      }

      // Fill in server-only trace sources
      if (mappings?.mapping) {
        await this.fillServerOnlyTraceSources({
          mapping: mappings.mapping,
          mappedData: mappedData as Record<string, unknown>,
          trace,
        });
      }

      data = mappedData as Record<string, unknown>;

      // Resolve any thread-typed mappings mixed into trace-level evaluations
      if (mappings && hasThreadMappings(mappings)) {
        await resolveThreadMappingsIntoData({
          data,
          trace,
          mappings,
          spanDigest: this.deps.spanDigest,
          getThreadTraces: (threadId) =>
            this.deps.traces.readThreadsTraces({
              projectId,
              threadIds: [threadId],
              protections: INTERNAL_PROTECTIONS,
            }),
        });
      }
    }

    // Workflow/code/custom evaluators pass data through as-is
    if (
      evaluatorType.startsWith("custom/") ||
      evaluatorType === "workflow" ||
      isCodeEvaluatorCheckType(evaluatorType)
    ) {
      return { type: "custom", data };
    }

    const evaluator = AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes];
    if (!evaluator) {
      throw new EvaluatorNotFoundError(evaluatorType);
    }

    // An evaluator this install skipped is not a broken one. Say which it is,
    // and how to get it, rather than letting the request reach an evaluator
    // service with no route for it and come back as a bare 404.
    const unavailable = findUnavailability({
      evaluatorType,
      environment: this.deps.installEnvironment,
    });
    if (unavailable) {
      throw new EvaluatorConfigError(unavailableEvaluatorMessage({ unavailability: unavailable }), {
        meta: { evaluatorType },
      });
    }

    const fields = [...evaluator.requiredFields, ...evaluator.optionalFields];
    const filtered = Object.fromEntries(fields.map((field) => [field, data[field] ?? ""]));

    return { type: "default", data: filtered };
  }

  private async buildThreadData(
    projectId: string,
    trace: Trace,
    mappings: MappingState | null,
  ): Promise<Record<string, unknown>> {
    if (!mappings) {
      throw new EvaluatorConfigError("Mapping state is required for thread-based evaluation");
    }

    const threadId = trace.metadata?.thread_id;
    if (!threadId) {
      throw new EvaluatorConfigError("Trace does not have a thread_id for thread-based evaluation");
    }

    const threadTraces = await this.deps.traces.readThreadsTraces({
      projectId,
      threadIds: [threadId],
      protections: INTERNAL_PROTECTIONS,
    });

    const result: Record<string, unknown> = {};

    for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
      if (!("source" in mappingConfig)) continue;

      const outcome = isThreadSourced(mappingConfig)
        ? await this.resolveThreadSource({ mappingConfig, threadId, threadTraces })
        : await this.resolveTraceSource({ targetField, mappingConfig, trace });
      if (outcome.resolved) result[targetField] = outcome.value;
    }

    return result;
  }

  private async resolveThreadSource({
    mappingConfig,
    threadId,
    threadTraces,
  }: {
    mappingConfig: SourcedMapping;
    threadId: string;
    threadTraces: Trace[];
  }): Promise<FieldOutcome> {
    const source = mappingConfig.source;
    if (!source) return { resolved: false };

    if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
      if (source !== "formatted_traces") return { resolved: false };

      const formatted = await Promise.all(
        threadTraces.map((t) => this.deps.spanDigest.format(t.spans ?? [])),
      );
      return { resolved: true, value: formatted.join("\n\n---\n\n") };
    }

    const threadSource = source as keyof typeof THREAD_MAPPINGS;
    const selectedFields =
      ("selectedFields" in mappingConfig ? mappingConfig.selectedFields : undefined) ?? [];
    return {
      resolved: true,
      value: THREAD_MAPPINGS[threadSource].mapping(
        { thread_id: threadId, traces: threadTraces },
        selectedFields as (keyof typeof TRACE_MAPPINGS)[],
      ),
    };
  }

  private async resolveTraceSource({
    targetField,
    mappingConfig,
    trace,
  }: {
    targetField: string;
    mappingConfig: SourcedMapping;
    trace: Trace;
  }): Promise<FieldOutcome> {
    if ((SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(mappingConfig.source)) {
      if (mappingConfig.source !== "formatted_trace") return { resolved: false };

      return { resolved: true, value: await this.deps.spanDigest.format(trace.spans ?? []) };
    }

    const traceMappingConfig: { source: string; key?: string; subkey?: string } = {
      source: mappingConfig.source,
      key: "key" in mappingConfig ? mappingConfig.key : undefined,
      subkey: "subkey" in mappingConfig ? mappingConfig.subkey : undefined,
    };
    const mapped = mapTraceToDatasetEntry({
      trace,
      mapping: { [targetField]: traceMappingConfig },
      expansions: new Set(),
    })[0];
    return { resolved: true, value: mapped?.[targetField] };
  }
}

type SourcedMapping = Extract<MappingState["mapping"][string], { source: unknown }>;

type FieldOutcome = { resolved: true; value: unknown } | { resolved: false };

function isThreadSourced(mappingConfig: SourcedMapping): boolean {
  return (
    ("type" in mappingConfig && mappingConfig.type === "thread") ||
    mappingConfig.source in THREAD_MAPPINGS ||
    (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(mappingConfig.source)
  );
}

function mapTraceFields(
  trace: Trace,
  mapping_: MappingState,
): Record<string, string | number> | undefined {
  const mapping: MappingState =
    "mapping" in mapping_ ? mapping_ : migrateLegacyMappings(legacyMappingOf(mapping_));

  return mapTraceToDatasetEntry({
    trace,
    mapping: mapping.mapping as Record<string, { source: string; key?: string; subkey?: string }>,
    expansions: new Set(),
  })[0];
}

/** A pre-`MappingState` monitor mapping: each target field names its trace source. */
function legacyMappingOf(value: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
