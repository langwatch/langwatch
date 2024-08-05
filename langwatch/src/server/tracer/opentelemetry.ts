import {
  type IAnyValue,
  type IExportTraceServiceRequest,
  type IInstrumentationScope,
  type IKeyValue,
  type ISpan,
  // @ts-ignore
} from "@opentelemetry/otlp-transformer";
import type { BaseSpan, LLMSpan, Span, TypedValueChatMessages } from "./types";
import { cloneDeep } from "lodash";
import {
  spanTypesSchema,
  typedValueChatMessagesSchema,
} from "./types.generated";
import type { CollectorJob } from "../background/types";

export type TraceForCollection = Pick<
  CollectorJob,
  "traceId" | "spans" | "reservedTraceMetadata" | "customMetadata"
>;

export const openTelemetryTraceRequestToTracesForCollection = (
  otelTrace: IExportTraceServiceRequest
): TraceForCollection[] => {
  // A single otelTrace may contain multiple traces with multiple spans each,
  // we need to account for that, that's why it's always one otelTrace to many traces
  decodeOpenTelemetryIds(otelTrace);

  const traceIds =
    otelTrace.resourceSpans?.flatMap((resourceSpan) => {
      return (
        resourceSpan.scopeSpans?.flatMap((scopeSpan) => {
          return scopeSpan.spans?.flatMap((span) => span.traceId) ?? [];
        }) ?? []
      );
    }) ?? [];

  const traces: TraceForCollection[] = traceIds.map((traceId) =>
    openTelemetryTraceRequestToTraceForCollection(traceId, {
      resourceSpans: otelTrace.resourceSpans?.filter((resourceSpan) =>
        resourceSpan.scopeSpans.some((scopeSpan) =>
          scopeSpan.spans.some((span) => span.traceId === traceId)
        )
      ),
    })
  );

  return traces;
};

const decodeOpenTelemetryIds = (otelTrace: IExportTraceServiceRequest) => {
  for (const resourceSpan of otelTrace.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const span of scopeSpan.spans) {
        if (span.traceId) {
          span.traceId = Buffer.from(span.traceId, "base64").toString("hex");
        }
        if (span.spanId) {
          span.spanId = Buffer.from(span.spanId, "base64").toString("hex");
        }
      }
    }
  }
};

const openTelemetryTraceRequestToTraceForCollection = (
  traceId: string,
  otelTrace_: IExportTraceServiceRequest
): TraceForCollection => {
  const otelTrace = cloneDeep(otelTrace_);

  const customMetadata = {};
  for (const resourceSpan of otelTrace.resourceSpans) {
    for (const attribute of resourceSpan.resource.attributes) {
      customMetadata[attribute.key] = attribute.value.stringValue;
    }
  }

  const trace: TraceForCollection = {
    traceId,
    spans: [],
    reservedTraceMetadata: {},
    customMetadata,
  };

  for (const resourceSpan of otelTrace.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const span of scopeSpan.spans) {
        if (span.traceId === traceId) {
          addOpenTelemetrySpanAsSpan(trace, span, scopeSpan.scope);
        }
      }
    }
  }

  return trace;
};

const allowedSpanTypes = spanTypesSchema.options.map((option) => option.value);

const addOpenTelemetrySpanAsSpan = (
  trace: TraceForCollection,
  otelSpan: ISpan,
  otelScope: IInstrumentationScope | undefined
): void => {
  let type: Span["type"] = "span";
  let model: LLMSpan["model"] = null;
  let input: LLMSpan["input"] = null;
  let output: LLMSpan["output"] = null;
  let params: Span["params"] = {};
  const started_at: Span["timestamps"]["started_at"] = Math.round(
    parseInt(otelSpan.startTimeUnixNano, 10) / 1000 / 1000
  );
  const finished_at: Span["timestamps"]["finished_at"] = Math.round(
    parseInt(otelSpan.endTimeUnixNano, 10) / 1000 / 1000
  );

  let first_token_at: Span["timestamps"]["first_token_at"] = null;
  for (const event of otelSpan.events) {
    if (event.name === "First Token Stream Event") {
      first_token_at = Math.round(
        parseInt(event.timeUnixNano, 10) / 1000 / 1000
      );
    }
  }

  const attributesMap = keyValueToObject(otelSpan.attributes);
  if (attributesMap.openinference?.span?.kind) {
    const kind_ = attributesMap.openinference.span.kind.toLowerCase();
    if (allowedSpanTypes.includes(kind_)) {
      type = kind_;
      delete attributesMap.openinference.span.kind;
    }
  }

  if (attributesMap.llm?.model_name) {
    model = attributesMap.llm.model_name;
    delete attributesMap.llm.model_name;
  }

  if (Array.isArray(attributesMap.llm?.input_messages)) {
    const input_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.input_messages.map((message) => message.message),
    });

    if (input_.success) {
      input = input_.data as TypedValueChatMessages;
      delete attributesMap.llm.input_messages;
    }
  }

  if (!input && attributesMap.input?.value) {
    input =
      typeof attributesMap.input.value === "string"
        ? {
            type: "text",
            value: attributesMap.input.value,
          }
        : {
            type: "json",
            value: attributesMap.input.value,
          };
  }
  delete attributesMap.input;

  if (Array.isArray(attributesMap.llm?.output_messages)) {
    const output_ = typedValueChatMessagesSchema.safeParse({
      type: "chat_messages",
      value: attributesMap.llm.output_messages.map(
        (message) => message.message
      ),
    });

    if (output_.success) {
      output = output_.data as TypedValueChatMessages;
      delete attributesMap.llm.output_messages;
    }
  }

  if (!output && attributesMap.output?.value) {
    output =
      typeof attributesMap.output.value === "string"
        ? {
            type: "text",
            value: attributesMap.output.value,
          }
        : {
            type: "json",
            value: attributesMap.output.value,
          };
  }
  delete attributesMap.output;

  if (attributesMap.user?.id) {
    trace.reservedTraceMetadata.user_id = attributesMap.user.id;
    delete attributesMap.user.id;
  }

  if (attributesMap.session?.id) {
    trace.reservedTraceMetadata.thread_id = attributesMap.session.id;
    delete attributesMap.session.id;
  }

  if (Array.isArray(attributesMap.tag?.tags)) {
    trace.reservedTraceMetadata.labels = attributesMap.tag.tags;
    delete attributesMap.tag.tags;
  }

  if (
    attributesMap.metadata &&
    typeof attributesMap.metadata === "object" &&
    !Array.isArray(attributesMap.metadata)
  ) {
    trace.customMetadata = {
      ...trace.customMetadata,
      ...attributesMap.metadata,
    };
    delete attributesMap.metadata;
  }

  if (attributesMap.llm?.invocation_parameters) {
    params = attributesMap.llm.invocation_parameters;
    delete attributesMap.llm.invocation_parameters;
  }

  params = {
    ...params,
    ...removeEmptyKeys(attributesMap),
    ...(otelScope ? { scope: otelScope } : {}),
  };

  const span: BaseSpan & { model: LLMSpan["model"] } = {
    span_id: otelSpan.spanId,
    trace_id: otelSpan.traceId,
    name: otelSpan.name,
    type,
    model,
    input,
    output,
    params,
    timestamps: {
      started_at,
      finished_at,
      ...(first_token_at ? { first_token_at } : {}),
    },
  };

  trace.spans.push(span);
};

const keyValueToObject = (attributes: IKeyValue): Record<string, any> => {
  const result: Record<string, any> = {};

  attributes.forEach(({ key, value }: { key: string; value: IAnyValue }) => {
    const keys = key.split(".");
    let current = result;

    keys.forEach((k, i) => {
      if (i === keys.length - 1) {
        current[k] = iAnyValueToValue(value);
      } else {
        if (/^\d+$/.test(keys[i + 1])) {
          // Next key is a number, so this should be an array
          current[k] = current[k] || [];
        } else {
          current[k] = current[k] || {};
        }
        current = current[k];
      }
    });
  });

  // Convert numbered object keys to arrays
  const convertToArrays = (obj: Record<string, any>): any => {
    for (const key in obj) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        obj[key] = convertToArrays(obj[key]);
        if (Object.keys(obj[key]).every((k) => /^\d+$/.test(k))) {
          obj[key] = Object.values(obj[key]);
        }
      }
    }
    return obj;
  };

  return convertToArrays(result);
};

const iAnyValueToValue = (value: IAnyValue): any => {
  if (value.stringValue) {
    // Try to parse JSON if possible
    try {
      return JSON.parse(value.stringValue);
    } catch {
      return value.stringValue;
    }
  }
  if (value.arrayValue) {
    return value.arrayValue.values.map((v) => iAnyValueToValue(v));
  }
  if (value.boolValue) {
    return value.boolValue;
  }
  if (value.intValue) {
    return value.intValue;
  }
  if (value.doubleValue) {
    return value.doubleValue;
  }
  if (value.bytesValue) {
    return Buffer.from(value.bytesValue.value).toString("base64");
  }
  if (value.kvlistValue) {
    return Object.fromEntries(
      value.kvlistValue.values.map((v: IKeyValue) => [
        v.key,
        iAnyValueToValue(v),
      ])
    );
  }
};

const removeEmptyKeys = (obj: Record<string, any>): Record<string, any> => {
  const isEmptyObject = (value: any): boolean =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;

  const isEmptyArray = (value: any): boolean =>
    Array.isArray(value) && value.length === 0;

  const isEmpty = (value: any): boolean =>
    value === null ||
    value === undefined ||
    isEmptyObject(value) ||
    isEmptyArray(value);

  if (!obj) return obj;

  if (typeof obj === "string") return obj;

  if (Array.isArray(obj)) {
    return obj.map(removeEmptyKeys).filter((v) => !isEmpty(v));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "object" && value !== null) {
      const cleanedValue = removeEmptyKeys(value as Record<string, any>);
      if (!isEmpty(cleanedValue)) {
        result[key] = cleanedValue;
      }
    } else if (!isEmpty(value)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : {};
};
