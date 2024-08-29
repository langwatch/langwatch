import { type LangWatchSpan, type LangWatchTrace } from "./index";
import { type Conversation } from "./server/types/evaluations";
import {
  type Evaluators,
  type EvaluatorTypes,
} from "./server/types/evaluators.generated";
import {
  type RAGChunk,
  type SpanTypes,
  type TypedValueEvaluationResult,
  type TypedValueGuardrailResult,
  type TypedValueJson,
} from "./server/types/tracer";

type Money = {
  currency: string;
  amount: number;
};

export type EvaluationResultModel = {
  status: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  details?: string;
  label?: string;
  cost?: Money;
};

export type CommonEvaluationParams = {
  name?: string;
  input?: string;
  output?: string;
  expectedOutput?: string;
  contexts?: RAGChunk[] | string[];
  conversation?: Conversation;
  asGuardrail?: boolean;
  trace?: LangWatchTrace;
  span?: LangWatchSpan;
};

export type SavedEvaluationParams = {
  slug: string;
  settings?: Record<string, unknown>;
} & CommonEvaluationParams;

export type LangEvalsEvaluationParams<T extends EvaluatorTypes> = {
  evaluator: T;
  settings?: Evaluators[T]["settings"];
} & CommonEvaluationParams;

export type EvaluationParams =
  | SavedEvaluationParams
  | LangEvalsEvaluationParams<EvaluatorTypes>;

export const evaluate = async (
  params: EvaluationParams
): Promise<EvaluationResultModel> => {
  const slug = "slug" in params ? params.slug : params.evaluator;
  const span = optionalCreateSpan({
    trace: params.trace,
    span: params.span,
    name: params.name ? params.name : slug,
    type: params.asGuardrail ? "guardrail" : "evaluation",
  });

  try {
    const requestParams = prepareData({
      ...params,
      slug,
      traceId: span?.trace.traceId,
      spanId: span?.spanId,
      span,
    });

    const response = await fetch(requestParams.url, {
      method: "POST",
      headers: requestParams.headers,
      body: JSON.stringify(requestParams.json),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    return handleResponse(result, span, params.asGuardrail);
  } catch (e) {
    return handleException(e as Error, span, params.asGuardrail);
  }
};

const optionalCreateSpan = ({
  trace,
  span,
  name,
  type,
}: {
  trace?: LangWatchTrace;
  span?: LangWatchSpan;
  name: string;
  type: SpanTypes;
}): LangWatchSpan | undefined => {
  if (span) {
    return span.startSpan({ name, type });
  } else if (trace) {
    return trace.startSpan({ name, type });
  }
  return undefined;
};

const prepareData = (params: {
  slug: string;
  name?: string;
  input?: string;
  output?: string;
  expectedOutput?: string;
  contexts?: RAGChunk[] | string[];
  conversation?: Conversation;
  settings?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  span?: LangWatchSpan;
  asGuardrail?: boolean;
}) => {
  const data: Record<string, unknown> = {};
  if (params.input) data.input = params.input;
  if (params.output) data.output = params.output;
  if (params.expectedOutput) data.expected_output = params.expectedOutput;
  if (params.contexts && params.contexts.length > 0)
    data.contexts = params.contexts;
  if (params.conversation && params.conversation.length > 0)
    data.conversation = params.conversation;

  if (params.span) {
    params.span.update({
      input: { type: "json", value: data } as TypedValueJson,
      params: params.settings,
    });
  }

  return {
    url: `${process.env.LANGWATCH_ENDPOINT}/api/evaluations/${params.slug}/evaluate`,
    json: {
      trace_id: params.traceId,
      span_id: params.spanId,
      name: params.name,
      data,
      settings: params.settings,
      as_guardrail: params.asGuardrail,
    },
    headers: {
      "X-Auth-Token": process.env.LANGWATCH_API_KEY ?? "",
      "Content-Type": "application/json",
    },
  };
};

const handleResponse = (
  response: EvaluationResultModel,
  span?: LangWatchSpan,
  asGuardrail = false
): EvaluationResultModel => {
  if (response.status === "error") {
    response.details = response.details ?? "";
  }

  for (const key of Object.keys(response)) {
    if (
      response[key as keyof EvaluationResultModel] === null ||
      response[key as keyof EvaluationResultModel] === undefined
    ) {
      delete response[key as keyof EvaluationResultModel];
    }
  }

  if (span) {
    const output: TypedValueGuardrailResult | TypedValueEvaluationResult =
      asGuardrail
        ? {
            type: "guardrail_result",
            value: response,
          }
        : {
            type: "evaluation_result",
            value: response,
          };

    span.update({ output });

    if (response.cost) {
      span.update({
        metrics: {
          cost: response.cost.amount,
        },
      });
    }

    span.end();
  }

  return response;
};

const handleException = (
  e: Error,
  span?: LangWatchSpan,
  asGuardrail = false
): EvaluationResultModel => {
  const response: EvaluationResultModel = {
    status: "error",
    details: e.toString(),
  };

  if (asGuardrail) {
    response.passed = true;
  }

  return handleResponse(response, span, asGuardrail);
};
