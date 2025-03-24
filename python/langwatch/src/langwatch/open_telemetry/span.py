from opentelemetry import trace
from opentelemetry.trace import SpanKind, Context, _Links
from typing import Optional, Callable, Any, TypeVar, Dict
from langwatch.open_telemetry.tracer import stored_tracer

__all__ = ["span", "SpanType"]

class SpanType:
    Normal = "normal"
    LLM = "llm"
    RAG = "rag"

T = TypeVar("T", bound=Callable[..., Any])

class Span:
    def __init__(
        self,
        name: str,
        type: SpanType,
        kind: SpanKind = SpanKind.INTERNAL,
        context: Optional[Context] = None,
        attributes: Optional[Dict[str, Any]] = None,
        links: Optional[_Links] = None,
        start_time: Optional[int] = None,
        record_exception: bool = True,
        set_status_on_exception: bool = True,
        end_on_exit: bool = True,
    ) -> None:
        self.name = name
        self.type = type
        self.kind = kind
        self.context = context
        self.attributes = attributes
        self.links = links
        self.start_time = start_time
        self.record_exception = record_exception
        self.set_status_on_exception = set_status_on_exception
        self.end_on_exit = end_on_exit

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        tracer = stored_tracer.get(None) or trace.get_tracer("langwatch.tracer")

        if len(args) == 1 and callable(args[0]) and not kwargs:
            func: Callable[..., Any] = args[0]
            def wrapper(*wargs: Any, **wkwargs: Any) -> Any:
                with tracer.start_as_current_span(
                    name=self.name,
                    context=self.context,
                    kind=self.kind,
                    attributes=self.attributes,
                    links=self.links,
                    start_time=self.start_time,
                    record_exception=self.record_exception,
                    set_status_on_exception=self.set_status_on_exception,
                    end_on_exit=self.end_on_exit,
                ) as span:
                    print(f"Span: {span}")
                    result = func(*wargs, **wkwargs)
                    return result

            return wrapper  # type: ignore

        span = tracer.start_span(
            name=self.name,
            context=self.context,
            kind=self.kind,
            attributes=self.attributes,
            links=self.links,
            start_time=self.start_time,
            record_exception=self.record_exception,
            set_status_on_exception=self.set_status_on_exception,
            end_on_exit=self.end_on_exit,
        )
        return span

    def __enter__(self) -> "Span":
        return self

    def __exit__(self, exc_type: Optional[type], exc_value: Optional[BaseException], traceback: Any) -> bool:
        return False

def span(
    name: str,
    type: SpanType,
    kind: SpanKind = SpanKind.INTERNAL,
    context: Optional[Context] = None,
    attributes: Optional[Dict[str, Any]] = None,
    links: Optional[_Links] = None,
    start_time: Optional[int] = None,
    record_exception: bool = True,
    set_status_on_exception: bool = True,
    end_on_exit: bool = True,
) -> Span:
    return Span(
        name=name,
        type=type,
        kind=kind,
        context=context,
        attributes=attributes,
        links=links,
        start_time=start_time,
        record_exception=record_exception,
        set_status_on_exception=set_status_on_exception,
        end_on_exit=end_on_exit,
    )
