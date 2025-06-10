"""OpenTelemetry metadata key name constants."""


class AttributeKey:
    """Attribute names organized by category. They come from the OpenTelemetry Spec https://opentelemetry.io/docs/specs/semconv/, version 1.32.0"""

    # Service attributes (OpenTelemetry Spec) - https://opentelemetry.io/docs/specs/semconv/attributes-registry/service/
    ServiceName = "service.name"
    ServiceVersion = "service.version"
    ServiceNamespace = "service.namespace"
    ServiceInstanceId = "service.instance.id"

    # Server attributes (OpenTelemetry Spec) - https://opentelemetry.io/docs/specs/semconv/attributes-registry/server/
    ServerAddress = "server.address"
    ServerPort = "server.port"

    # User attributes (OpenTelemetry Spec) - https://opentelemetry.io/docs/specs/semconv/attributes-registry/user/
    UserId = "user.id"
    UserEmail = "user.email"
    UserFullName = "user.full_name"
    UserHash = "user.email"
    UserName = "user.name"
    UserRoles = "user.roles"

    # Error attributes (OpenTelemetry Spec) - https://opentelemetry.io/docs/specs/semconv/attributes-registry/error/
    ErrorType = "error.type"
    ErrorMessage = "error.message"
    ErrorStack = "error.stack"

    # GenAI (OpenTelemetry Spec) - https://opentelemetry.io/docs/specs/semconv/attributes-registry/gen-ai/
    GenAIAgentDescription = "gen_ai.agent.description"
    GenAIAgentId = "gen_ai.agent.id"
    GenAIAgentName = "gen_ai.agent.name"
    GenAIOperationName = "gen_ai.operation.name"
    GenAIOutputType = "gen_ai.output.type"
    GenAIRequestChoiceCount = "gen_ai.request.choice.count"
    GenAIRequestEncodingFormats = "gen_ai.request.encoding_formats"
    GenAIRequestFrequencyPenalty = "gen_ai.request.frequency_penalty"
    GenAIRequestMaxTokens = "gen_ai.request.max_tokens"
    GenAIRequestModel = "gen_ai.request.model"
    GenAIRequestPresencePenalty = "gen_ai.request.presence_penalty"
    GenAIRequestSeed = "gen_ai.request.seed"
    GenAIRequestStopSequences = "gen_ai.request.stop_sequences"
    GenAIRequestTemperature = "gen_ai.request.temperature"
    GenAIRequestTopK = "gen_ai.request.top_k"
    GenAIRequestTopP = "gen_ai.request.top_p"
    GenAIResponseFinishReasons = "gen_ai.response.finish_reasons"
    GenAIResponseId = "gen_ai.response.id"
    GenAIResponseModel = "gen_ai.response.model"
    GenAISystem = "gen_ai.system"
    GenAITokenType = "gen_ai.token.type"
    GenAIToolCallId = "gen_ai.tool.call.id"
    GenAIToolName = "gen_ai.tool.name"
    GenAIToolType = "gen_ai.tool.type"
    GenAIUsageInputTokens = "gen_ai.usage.input_tokens"
    GenAIUsageOutputTokens = "gen_ai.usage.output_tokens"

    # LangWatch
    LangWatchSpanType = "langwatch.span.type"
    LangWatchRAGContexts = "langwatch.rag_contexts"
    LangWatchInput = "langwatch.input"
    LangWatchSDKVersion = "langwatch.sdk.version"
    LangWatchSDKName = "langwatch.sdk.name"
    LangWatchSDKLanguage = "langwatch.sdk.language"
    LangWatchOutput = "langwatch.output"
    LangWatchTimestamps = "langwatch.timestamps"
    LangWatchParams = "langwatch.params"
    LangWatchMetrics = "langwatch.metrics"
    LangWatchCustomerId = "langwatch.customer.id"
    LangWatchThreadId = "langwatch.thread.id"
    LangWatchSessionId = "langwatch.session.id"  # We use thread_id for session_id
    LangWatchEventEvaluationCustom = "langwatch.evaluation.custom"
    LangWatchEventEvaluationLog = "langwatch.evaluation.log"

    LangWatchPromptId = "langwatch.prompt.id"
    LangWatchPromptVersionId = "langwatch.prompt.version.id"
    LangWatchPromptVersionNumber = "langwatch.prompt.version.number"

    # Deprecated attributes
    DeprecatedTraceId = "deprecated.trace.id"
    DeprecatedSpanId = "deprecated.span.id"
