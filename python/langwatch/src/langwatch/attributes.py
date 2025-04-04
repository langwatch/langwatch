"""OpenTelemetry metadata key name constants."""

class AttributeName:
    """OpenTelemetry attribute names organized by category."""

    # Service attributes
    ServiceName = "service.name"
    ServiceVersion = "service.version"
    ServiceNamespace = "service.namespace"
    ServiceInstanceId = "service.instance.id"

    # Error attributes
    ErrorType = "error.type"
    ErrorMessage = "error.message"
    ErrorStack = "error.stack"

    # Trace context
    TraceId = "trace.id"
    SpanId = "span.id"
    ParentSpanId = "parent.span.id"

class MetadataName:
    """Metadata names organized by category, these are specific to LangWatch"""

    UserId = "user_id"
    CustomerId = "customer_id"
    ThreadId = "thread_id"
    SessionId = "thread_id" # We use thread_id for session_id

    RAGContexts = "langwatch.rag_contexts"
