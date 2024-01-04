import type { Project } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import similarity from "compute-cosine-similarity";
import { estimateCost, tokenizeAndEstimateCost } from "llm-cost";
import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import { SPAN_INDEX, TRACE_INDEX, esClient } from "../../server/elasticsearch";
import { getOpenAIEmbeddings } from "../../server/embeddings";
import {
  type CollectorRESTParamsValidator,
  type ElasticSearchInputOutput,
  type ElasticSearchSpan,
  type ErrorCapture,
  type LLMSpan,
  type Span,
  type SpanInput,
  type SpanOutput,
  type Trace,
  type TraceInputOutput,
} from "../../server/tracer/types";
import {
  collectorRESTParamsValidatorSchema,
  spanValidatorSchema,
} from "../../server/tracer/types.generated";
import {
  convertToTraceCheckResult,
  runPiiCheck,
} from "../../trace_checks/backend/piiCheck";
import {
  scheduleTraceCheck,
  updateCheckStatusInES,
} from "../../trace_checks/queue";
import type {
  CheckPreconditions,
  CheckTypes,
  Checks,
} from "../../trace_checks/types";
import { getDebugger } from "../../utils/logger";
import { addInputAndOutputForRAGs } from "./collector/rag";
import {
  getFirstInputAsText,
  getLastOutputAsText,
  typedValueToText,
} from "./collector/common";
import { getTraceCheckDefinitions } from "../../trace_checks/registry";

const debug = getDebugger("langwatch:collector");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  let params: CollectorRESTParamsValidator;
  try {
    params = collectorRESTParamsValidatorSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid trace received",
      error,
      JSON.stringify(req.body, null, "  ")
    );
    Sentry.captureException(error);
    return res.status(400).json({ error: "Invalid trace format." });
  }

  const {
    trace_id: nullableTraceId,
    thread_id: threadId,
    user_id: userId,
    customer_id: customerId,
    labels,
  } = params;

  if (!req.body.spans) {
    return res.status(400).json({ message: "Bad request" });
  }

  const spans = addInputAndOutputForRAGs(
    await addLLMTokensCount((req.body as Record<string, any>).spans as Span[])
  );
  spans.forEach((span) => {
    if (nullableTraceId && !span.trace_id) {
      span.trace_id = nullableTraceId;
    }
  });
  const traceId = nullableTraceId ?? spans[0]?.trace_id;
  if (!traceId) {
    return res.status(400).json({ message: "Trace ID not defined" });
  }

  for (const span of spans) {
    try {
      spanValidatorSchema.parse(span);
    } catch (error) {
      debug("Invalid span received", error, JSON.stringify(span, null, "  "));
      Sentry.captureException(error);
      return res.status(400).json({ error: "Invalid span format." });
    }
  }

  const esSpans: ElasticSearchSpan[] = spans.map((span) => ({
    ...span,
    input: span.input ? typedValueToElasticSearch(span.input) : null,
    outputs: span.outputs.map(typedValueToElasticSearch),
    project_id: project.id,
    // TODO: test
    raw_response:
      "raw_response" in span && span.raw_response
        ? JSON.stringify(span.raw_response)
        : null,
  }));

  const traceIds = Array.from(
    new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id))
  );
  if (!traceIds[0] || traceIds.length > 1 || traceIds[0] != traceId) {
    return res
      .status(400)
      .json({ message: "All spans must have the same trace id" });
  }

  debug(`collecting traceId ${traceId}`);

  const [input, output] = await Promise.all([
    getTraceInput(spans),
    getTraceOutput(spans),
  ]);
  const error = getLastOutputError(spans);
  const openAISearchEmbeddings = await getSearchEmbeddings(
    input,
    output,
    error
  );

  const nullToUndefined = <T>(value: T | null): T | undefined =>
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    value === null ? undefined : value;

  // Create the trace
  const trace: Trace = {
    id: traceId,
    project_id: project.id,
    thread_id: nullToUndefined(threadId), // Optional: This will be undefined if not sent
    user_id: nullToUndefined(userId), // Optional: This will be undefined if not sent
    customer_id: nullToUndefined(customerId),
    labels: nullToUndefined(labels),
    timestamps: {
      started_at: Math.min(...spans.map((span) => span.timestamps.started_at)),
      inserted_at: Date.now(),
    },
    input,
    output,
    metrics: computeTraceMetrics(spans),
    error,
    search_embeddings: {
      openai_embeddings: openAISearchEmbeddings,
    },
  };

  await cleanupPII(trace, esSpans);

  await esClient.index({
    index: TRACE_INDEX,
    id: trace.id,
    body: trace,
  });

  const result = await esClient.helpers.bulk({
    datasource: esSpans,
    pipeline: "ent-search-generic-ingestion",
    onDocument: (doc) => ({
      index: { _index: SPAN_INDEX, _id: doc.id, routing: doc.trace_id },
    }),
  });

  if (result.failed > 0) {
    console.error("Failed to insert to elasticsearch", result);
    return res.status(500).json({ message: "Something went wrong!" });
  }

  void scheduleTraceChecks(trace, spans);

  await markProjectFirstMessage(project);

  return res.status(200).json({ message: "Traces received successfully." });
}

const getTraceInput = async (spans: Span[]): Promise<Trace["input"]> => {
  const value = getFirstInputAsText(spans);
  const openai_embeddings = value
    ? await getOpenAIEmbeddings(value)
    : undefined;
  return { value: value, openai_embeddings };
};

const getTraceOutput = async (spans: Span[]): Promise<Trace["output"]> => {
  const value = getLastOutputAsText(spans);
  const openai_embeddings = value
    ? await getOpenAIEmbeddings(value)
    : undefined;
  return { value: value, openai_embeddings };
};

export const getSearchEmbeddings = async (
  input: TraceInputOutput,
  output: TraceInputOutput | undefined,
  error: ErrorCapture | null
): Promise<number[] | undefined> => {
  const terms = [input.value, output?.value ?? "", error?.message ?? ""];
  if (terms.filter((term) => term).length == 0) {
    return undefined;
  }

  return await getOpenAIEmbeddings(terms.join("\n\n"));
};

const typedValueToElasticSearch = (
  typed: SpanInput | SpanOutput
): ElasticSearchInputOutput => {
  return {
    type: typed.type,
    value: JSON.stringify(typed.value),
  };
};

// TODO: test
const getLastOutputError = (spans: Span[]): ErrorCapture | null => {
  // TODO: shouldn't it be sorted by parent-child?
  const errorSpans = spans.filter((span) => span.error);
  const lastError = errorSpans[errorSpans.length - 1];
  if (!lastError) {
    return null;
  }
  return lastError.error ?? null;
};

// TODO: test
const computeTraceMetrics = (spans: Span[]): Trace["metrics"] => {
  let earliestStartedAt: number | null = null;
  let latestFirstTokenAt: number | null = null;
  let latestFinishedAt: number | null = null;

  let totalPromptTokens: number | null = null;
  let totalCompletionTokens: number | null = null;
  let tokensEstimated = false;
  let totalCost: number | null = null;

  spans.forEach((span) => {
    if (
      earliestStartedAt === null ||
      span.timestamps.started_at < earliestStartedAt
    ) {
      earliestStartedAt = span.timestamps.started_at;
    }

    if (
      span.timestamps.first_token_at &&
      (latestFirstTokenAt === null ||
        span.timestamps.first_token_at > latestFirstTokenAt)
    ) {
      latestFirstTokenAt = span.timestamps.first_token_at;
    }

    if (
      latestFinishedAt === null ||
      span.timestamps.finished_at > latestFinishedAt
    ) {
      latestFinishedAt = span.timestamps.finished_at;
    }

    if ("metrics" in span) {
      if (
        span.metrics.prompt_tokens !== undefined &&
        span.metrics.prompt_tokens !== null
      ) {
        if (!totalPromptTokens) {
          totalPromptTokens = 0;
        }
        totalPromptTokens += span.metrics.prompt_tokens;
      }
      if (
        span.metrics.completion_tokens !== undefined &&
        span.metrics.completion_tokens !== null
      ) {
        if (!totalCompletionTokens) {
          totalCompletionTokens = 0;
        }
        totalCompletionTokens += span.metrics.completion_tokens;
      }
      if (span.metrics.tokens_estimated) {
        tokensEstimated = true;
      }
      if (span.metrics.cost !== undefined && span.metrics.cost !== null) {
        if (!totalCost) {
          totalCost = 0;
        }
        totalCost += span.metrics.cost;
      }
    }
  });

  return {
    first_token_ms:
      latestFirstTokenAt && earliestStartedAt
        ? latestFirstTokenAt - earliestStartedAt
        : null,
    total_time_ms:
      latestFinishedAt && earliestStartedAt
        ? latestFinishedAt - earliestStartedAt
        : null,
    prompt_tokens: totalPromptTokens,
    completion_tokens: totalCompletionTokens,
    total_cost: totalCost,
    tokens_estimated: tokensEstimated,
  };
};

// TODO: extract to separate file
// TODO: test
const addLLMTokensCount = async (spans: Span[]) => {
  for (const span of spans) {
    if (span.type == "llm") {
      const llmSpan = span as LLMSpan;
      if (!llmSpan.metrics) {
        llmSpan.metrics = {};
      }
      if (llmSpan.input && !llmSpan.metrics.prompt_tokens) {
        llmSpan.metrics.prompt_tokens = (
          await tokenizeAndEstimateCost({
            model: llmSpan.model,
            input: typedValueToText(llmSpan.input),
          })
        ).inputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }
      if (llmSpan.outputs.length > 0 && !llmSpan.metrics.completion_tokens) {
        let outputTokens = 0;
        for (const output of llmSpan.outputs) {
          outputTokens += (
            await tokenizeAndEstimateCost({
              model: llmSpan.model,
              output: typedValueToText(output),
            })
          ).outputTokens;
        }
        llmSpan.metrics.completion_tokens = outputTokens;
        llmSpan.metrics.tokens_estimated = true;
      }

      llmSpan.metrics.cost = estimateCost({
        model: llmSpan.model,
        inputTokens: llmSpan.metrics.prompt_tokens ?? 0,
        outputTokens: llmSpan.metrics.completion_tokens ?? 0,
      });
    }
  }
  return spans;
};

const markProjectFirstMessage = async (project: Project) => {
  if (!project.firstMessage) {
    await prisma.project.update({
      where: { id: project.id },
      data: { firstMessage: true },
    });
  }
};

// TODO: extract to separate file
const cleanupPII = async (
  trace: Trace,
  spans: ElasticSearchSpan[]
): Promise<undefined> => {
  const results = await runPiiCheck(trace, spans);
  const { quotes } = results;

  const piiChecks = await prisma.check.findMany({
    where: {
      projectId: trace.project_id,
      enabled: true,
      checkType: "pii_check",
    },
  });

  // PII checks must run on every message anyway for GDPR compliance, however not always the user wants
  // that to fail the trace. So we only update the status if the check is enabled, accordingly to the
  // check configuration, and sampling condition.
  for (const piiCheck of piiChecks) {
    if (piiCheck.sample >= Math.random()) {
      const traceCheckResult = convertToTraceCheckResult(
        results,
        piiCheck.parameters as Checks["pii_check"]["parameters"]
      );
      await updateCheckStatusInES({
        check: {
          ...piiCheck,
          type: piiCheck.checkType as CheckTypes,
        },
        trace: trace,
        status: traceCheckResult.status,
        raw_result: traceCheckResult.raw_result,
        value: traceCheckResult.value,
      });
    }
  }

  for (const quote of quotes) {
    trace.input.value = trace.input.value.replace(quote, "[REDACTED]");
    if (trace.output?.value) {
      trace.output.value = trace.output.value.replace(quote, "[REDACTED]");
    }
    if (trace.error) {
      trace.error.message = trace.error.message.replace(quote, "[REDACTED]");
      // eslint-disable-next-line @typescript-eslint/no-for-in-array
      for (const stacktraceIndex in trace.error.stacktrace) {
        trace.error.stacktrace[stacktraceIndex] =
          trace.error.stacktrace[stacktraceIndex]?.replace(
            quote,
            "[REDACTED]"
          ) ?? "";
      }
    }
    for (const span of spans) {
      if (span.input?.value) {
        span.input.value = span.input.value.replace(quote, "[REDACTED]");
      }
      for (const output of span.outputs) {
        if (output.value) {
          output.value = output.value.replace(quote, "[REDACTED]");
        }
      }
      if (span.error) {
        span.error.message = span.error.message.replace(quote, "[REDACTED]");
        // eslint-disable-next-line @typescript-eslint/no-for-in-array
        for (const stacktraceIndex in span.error.stacktrace) {
          span.error.stacktrace[stacktraceIndex] =
            span.error.stacktrace[stacktraceIndex]?.replace(
              quote,
              "[REDACTED]"
            ) ?? "";
        }
      }
    }
  }
};

// TODO: extract to separate file
async function evaluatePreconditions(
  checkType: string,
  trace: Trace,
  spans: Span[],
  preconditions: CheckPreconditions
): Promise<boolean> {
  const checkDefinitions = getTraceCheckDefinitions(checkType);

  if (checkDefinitions?.requiresRag) {
    if (!spans.some((span) => span.type === "rag")) {
      return false;
    }
  }

  for (const precondition of preconditions) {
    const valueToCheck =
      precondition.field === "input"
        ? trace.input.value
        : trace.output?.value ?? "";
    switch (precondition.rule) {
      case "contains":
        if (
          !valueToCheck.toLowerCase().includes(precondition.value.toLowerCase())
        ) {
          return false;
        }
        break;
      case "not_contains":
        if (
          valueToCheck.toLowerCase().includes(precondition.value.toLowerCase())
        ) {
          return false;
        }
        break;
      case "matches_regex":
        try {
          const regex = new RegExp(precondition.value, "gi");
          if (!regex.test(valueToCheck)) {
            return false;
          }
        } catch (error) {
          console.error(
            `Invalid regex in preconditions: ${precondition.value}`
          );
          return false;
        }
        break;
      case "is_similar_to":
        const embeddings = precondition.openai_embeddings ?? [];
        if (
          embeddings.length === 0 ||
          !trace.search_embeddings.openai_embeddings
        ) {
          console.error(
            "No embeddings provided for is_similar_to precondition."
          );
          return false;
        }
        const similarityScore = similarity(
          embeddings,
          trace.search_embeddings.openai_embeddings
        );
        if ((similarityScore ?? 0) < precondition.threshold) {
          return false;
        }
        break;
    }
  }
  return true;
}

const scheduleTraceChecks = async (trace: Trace, spans: Span[]) => {
  const checks = await prisma.check.findMany({
    where: {
      projectId: trace.project_id,
      enabled: true,
      checkType: { not: "pii_check" },
    },
  });

  for (const check of checks) {
    if (Math.random() <= check.sample) {
      const preconditions = (check.preconditions ?? []) as CheckPreconditions;
      const preconditionsMet = await evaluatePreconditions(
        check.checkType,
        trace,
        spans,
        preconditions
      );
      if (preconditionsMet) {
        debug(
          `scheduling ${check.checkType} (checkId: ${check.id}) for trace ${trace.id}`
        );
        void scheduleTraceCheck({
          check: {
            ...check,
            type: check.checkType as CheckTypes,
          },
          trace: trace,
        });
      }
    }
  }
};
