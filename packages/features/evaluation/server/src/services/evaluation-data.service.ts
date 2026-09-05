/**
 * Building the data an evaluator sees: the trace or thread mappings resolved to values, with
 * the server-only sources (formatted spans) filled in here rather than in the browser.
 */

import {
  AVAILABLE_EVALUATORS,
  codeEvaluatorIdFromCheckType,
  DEFAULT_MAPPINGS,
  isCodeEvaluatorCheckType,
  isNativeEvaluatorType,
  migrateLegacyMappings,
  type EvaluatorTypes,
} from "@langwatch/evaluator-contract";
import {
  EvaluatorConfigError,
  EvaluatorNotFoundError,
  TraceNotEvaluatableError,
} from "@langwatch/evaluation-contract";
import {
  type MappingState,
  mapTraceToDatasetEntry,
  SERVER_ONLY_THREAD_SOURCES,
  SERVER_ONLY_TRACE_SOURCES,
  THREAD_MAPPINGS,
  type TRACE_MAPPINGS,
  type Trace,
} from "@langwatch/trace-contract";
import type { EvaluationTraceProtections } from "../ports/evaluation-execution.port";
import type { DataForEvaluation, EvaluationExecutionDeps } from "./evaluation-execution.service";
import { EvaluationThreadMappingService } from "./evaluation-thread-mapping.service";
import {
  EvaluatorAvailabilityService,
  type EvaluatorInstallEnvironment,
} from "./evaluator-availability.service";

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
      const mappedData = switchMapping(trace, mappings ?? DEFAULT_MAPPINGS);
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
      if (mappings && EvaluationThreadMappingService.hasThreadMappings(mappings)) {
        await EvaluationThreadMappingService.resolveThreadMappingsIntoData({
          data,
          trace,
          mappings,
          spanDigest: this.deps.spanDigest,
          getThreadTraces: (threadId) =>
            this.deps.traceService.getTracesWithSpansByThreadIds(
              projectId,
              [threadId],
              INTERNAL_PROTECTIONS,
              { full: true },
            ),
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
    const unavailable = EvaluatorAvailabilityService.tryEvaluatorUnavailability({
      evaluatorType,
      environment: this.deps.installEnvironment,
    });
    if (unavailable) {
      throw new EvaluatorConfigError(
        EvaluatorAvailabilityService.unavailableEvaluatorMessage({ unavailability: unavailable }),
        {
          meta: { evaluatorType },
        },
      );
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

    const threadTraces = await this.deps.traceService.getTracesWithSpansByThreadIds(
      projectId,
      [threadId],
      INTERNAL_PROTECTIONS,
      { full: true },
    );

    const result: Record<string, unknown> = {};

    for (const [targetField, mappingConfig] of Object.entries(mappings.mapping)) {
      const isThreadMapping =
        ("type" in mappingConfig && mappingConfig.type === "thread") ||
        ("source" in mappingConfig &&
          (mappingConfig.source in THREAD_MAPPINGS ||
            (SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(mappingConfig.source)));

      if (isThreadMapping && "source" in mappingConfig) {
        const source = mappingConfig.source;
        if (!source) {
          continue;
        }

        if ((SERVER_ONLY_THREAD_SOURCES as readonly string[]).includes(source)) {
          if (source === "formatted_traces") {
            result[targetField] = (
              await Promise.all(threadTraces.map((t) => this.deps.spanDigest.format(t.spans ?? [])))
            ).join("\n\n---\n\n");
          }
        } else {
          const threadSource = source as keyof typeof THREAD_MAPPINGS;
          const selectedFields =
            ("selectedFields" in mappingConfig ? mappingConfig.selectedFields : undefined) ?? [];
          result[targetField] = THREAD_MAPPINGS[threadSource].mapping(
            { thread_id: threadId, traces: threadTraces },
            selectedFields as (keyof typeof TRACE_MAPPINGS)[],
          );
        }
      } else if ("source" in mappingConfig) {
        // Regular trace mapping
        if ((SERVER_ONLY_TRACE_SOURCES as readonly string[]).includes(mappingConfig.source)) {
          if (mappingConfig.source === "formatted_trace") {
            result[targetField] = await this.deps.spanDigest.format(trace.spans ?? []);
          }
        } else {
          const traceMappingConfig: {
            source: string;
            key?: string;
            subkey?: string;
          } = {
            source: mappingConfig.source,
            key: mappingConfig.key,
            subkey: mappingConfig.subkey,
          };
          const mapped = mapTraceToDatasetEntry(
            trace,
            { [targetField]: traceMappingConfig },
            new Set(),
            undefined,
            undefined,
          )[0];
          result[targetField] = mapped?.[targetField];
        }
      }
    }

    return result;
  }
}

function switchMapping(
  trace: Trace,
  mapping_: MappingState,
): Record<string, string | number> | undefined {
  const mapping: MappingState =
    "mapping" in mapping_
      ? mapping_
      : migrateLegacyMappings(mapping_ as unknown as Record<string, string>);

  return mapTraceToDatasetEntry(
    trace,
    mapping.mapping as Record<
      string,
      {
        source: string;
        key?: string;
        subkey?: string;
      }
    >,
    new Set(),
    undefined,
    undefined,
  )[0];
}
