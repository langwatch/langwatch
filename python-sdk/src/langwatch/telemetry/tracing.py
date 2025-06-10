import functools
import json
from types import ModuleType
from uuid import UUID
import httpx
import threading
from deprecated import deprecated
from langwatch.attributes import AttributeKey
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    convert_typed_values,
)
from opentelemetry import trace as trace_api
from opentelemetry.sdk.trace import TracerProvider
from typing import (
    Dict,
    List,
    Literal,
    Optional,
    Callable,
    Any,
    Type,
    TypeVar,
    Union,
    cast,
    TYPE_CHECKING,
)
from warnings import warn
import inspect

from langwatch.state import get_api_key, get_endpoint, get_instance, set_api_key
from langwatch.domain import (
    ChatMessage,
    Conversation,
    Evaluation,
    EvaluationTimestamps,
    Money,
    MoneyDict,
    RAGChunk,
    SpanInputOutput,
    SpanMetrics,
    SpanParams,
    SpanTimestamps,
    SpanTypes,
    TraceMetadata,
)
from langwatch.telemetry.span import LangWatchSpan
from langwatch.__version__ import __version__
from langwatch.utils.initialization import ensure_setup
import langwatch.telemetry.context

if TYPE_CHECKING:
    from openai import OpenAI, AsyncOpenAI, AzureOpenAI, AsyncAzureOpenAI
    from langwatch.evaluations import BasicEvaluateData

__all__ = ["trace", "LangWatchTrace"]

T = TypeVar("T", bound=Callable[..., Any])


class LangWatchTrace:
    """A trace represents a complete request/response cycle in your application.
    It can contain multiple spans representing different operations within that cycle.
    """

    _root_span_params: Optional[Dict[str, Any]] = None
    _trace_id: Optional[int] = None  # Cached trace_id for after the spans finishes
    root_span: Optional[LangWatchSpan] = None
    span: type[LangWatchSpan]
    evaluations: List[Evaluation] = []

    def __init__(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        api_key: Optional[str] = None,
        disable_sending: bool = False,
        max_string_length: Optional[int] = 5000,
        # Root span parameters
        span_id: Optional[str] = None,
        capture_input: bool = True,
        capture_output: bool = True,
        name: Optional[str] = None,
        type: SpanTypes = "span",
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        model: Optional[str] = None,
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
        evaluations: Optional[List[Evaluation]] = None,
        skip_root_span: bool = False,
        tracer_provider: Optional[TracerProvider] = None,
    ):
        ensure_setup()
        if api_key is not None:
            warn(
                "Setting API key on trace is deprecated. Please set it on the LangWatch client instance instead using `langwatch.setup(api_key=<api_key>)`"
            )
            set_api_key(api_key=api_key)

        self.metadata = metadata
        self.api_key = api_key
        self.max_string_length = max_string_length
        self._context_token = None
        self._lock = threading.Lock()
        self._expected_output = expected_output
        self.span = cast(
            Type[LangWatchSpan], lambda **kwargs: LangWatchSpan(trace=self, **kwargs)
        )

        if self.metadata is None:
            self.metadata = {}
        if trace_id is not None:
            warn(
                "trace_id is deprecated and will be removed in a future version. Future versions of the SDK will not support it. Until that happens, the `trace_id` will be mapped to `deprecated.trace_id` in the trace's metadata."
            )
            self.metadata["deprecated.trace_id"] = str(trace_id)

        if disable_sending:
            client = get_instance()
            if client:
                client.disable_sending = True

        # Use the global tracer provider
        self._tracer_provider = tracer_provider
        self.tracer = (tracer_provider or trace_api).get_tracer(
            instrumenting_module_name="langwatch",
            instrumenting_library_version=__version__,
        )
        self._reset()

        # Store root span parameters for later creation
        self._skip_root_span = skip_root_span
        self._root_span_params = (
            {
                "span_id": span_id,
                "capture_input": capture_input,
                "capture_output": capture_output,
                "name": name,
                "type": type,
                "input": input,
                "output": output,
                "error": error,
                "timestamps": timestamps,
                "contexts": contexts,
                "model": model,
                "params": params,
                "metrics": metrics,
                "evaluations": evaluations,
            }
            if not skip_root_span
            else None
        )

    def _reset(self):
        self._cleaned_up = False

    def _clone(self) -> "LangWatchTrace":
        root_span_params = self._root_span_params or {}

        return LangWatchTrace(
            trace_id=(
                str(self.metadata.get("deprecated.trace_id", None))
                if self.metadata and self.metadata.get("deprecated.trace_id", None)
                else None
            ),
            metadata=self.metadata,
            expected_output=self._expected_output,
            api_key=self.api_key,
            disable_sending=self.disable_sending,
            max_string_length=self.max_string_length,
            tracer_provider=self._tracer_provider,
            span_id=root_span_params.get("span_id", None),
            capture_input=root_span_params.get("capture_input", True),
            capture_output=root_span_params.get("capture_output", True),
            name=root_span_params.get("name", None),
            type=root_span_params.get("type", "span"),
            input=root_span_params.get("input", None),
            output=root_span_params.get("output", None),
            error=root_span_params.get("error", None),
            timestamps=root_span_params.get("timestamps", None),
            contexts=root_span_params.get("contexts", None),
            model=root_span_params.get("model", None),
            params=root_span_params.get("params", None),
            metrics=root_span_params.get("metrics", None),
            evaluations=root_span_params.get("evaluations", None),
            skip_root_span=self._skip_root_span,
        )

    @property
    def trace_id(self) -> Optional[str]:
        if self._trace_id is None:
            return None
        return self._trace_id.to_bytes(16, "big").hex()

    def _create_root_span(self):
        """Create the root span if parameters were provided."""
        if self._root_span_params is not None:
            # Pre-serialize timestamps if present
            root_span_params = dict(self._root_span_params)
            if (
                "timestamps" in root_span_params
                and root_span_params["timestamps"] is not None
            ):
                root_span_params["timestamps"] = json.dumps(
                    root_span_params["timestamps"], cls=SerializableWithStringFallback
                )

            self.root_span = LangWatchSpan(trace=self, **root_span_params)
            self.root_span.__enter__()
            context = self.root_span.get_span_context()
            if context is not None:
                self._trace_id = context.trace_id
            return self.root_span

    def _cleanup(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> None:
        """Internal method to cleanup resources with proper locking."""
        with self._lock:
            if self._cleaned_up:
                return

            try:
                if self.root_span is not None:
                    self.root_span._cleanup(exc_type, exc_value, traceback)  # type: ignore
            except Exception as e:
                warn(f"Failed to cleanup root span: {e}")

            if self._context_token is not None:
                langwatch.telemetry.context._reset_current_trace(self._context_token)
                self._context_token = None

            self._cleaned_up = True

    def get_langchain_callback(self):
        ensure_setup()
        from langwatch.langchain import LangChainTracer

        return LangChainTracer(trace=self)

    def autotrack_openai_calls(
        self, client: Union["OpenAI", "AsyncOpenAI", "AzureOpenAI", "AsyncAzureOpenAI"]
    ):
        ensure_setup()
        import langwatch.openai

        langwatch.openai.OpenAITracer(trace=self, client=client)

    def autotrack_litellm_calls(self, client: ModuleType):
        ensure_setup()
        import langwatch.litellm

        langwatch.litellm.LiteLLMPatch(trace=self, client=client)

    def autotrack_dspy(
        self,
    ):
        ensure_setup()
        import langwatch.dspy

        langwatch.dspy.DSPyTracer(trace=self)

    def share(self) -> str:
        """Share this trace and get a shareable URL."""
        ensure_setup()
        endpoint = get_endpoint()
        trace_id = self.trace_id
        if trace_id is None:
            raise ValueError("Trace ID is not available from trace object")
        with httpx.Client() as client:
            response = client.post(
                f"{endpoint}/api/trace/{trace_id}/share",
                headers={"X-Auth-Token": get_api_key()},
                timeout=15,
            )
            response.raise_for_status()
            path = response.json()["path"]
            return f"{endpoint}{path}"

    def unshare(self):
        """Make this trace private again."""
        ensure_setup()
        endpoint = get_endpoint()
        trace_id = self.trace_id
        if trace_id is None:
            raise ValueError("Trace ID is not available from trace object")
        with httpx.Client() as client:
            response = client.post(
                f"{endpoint}/api/trace/{trace_id}/unshare",
                headers={"X-Auth-Token": get_api_key()},
                timeout=15,
            )
            response.raise_for_status()

    def update(
        self,
        trace_id: Optional[Union[str, UUID]] = None,
        metadata: Optional[TraceMetadata] = None,
        expected_output: Optional[str] = None,
        disable_sending: Optional[bool] = None,
        # root span update
        name: Optional[str] = None,
        type: Optional[SpanTypes] = None,
        input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[SpanTimestamps] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        model: Optional[str] = None,
        params: Optional[SpanParams] = None,
        metrics: Optional[SpanMetrics] = None,
    ) -> None:
        ensure_setup()

        client = get_instance()

        if metadata is None:
            metadata = {}
        if trace_id is not None:
            metadata[AttributeKey.DeprecatedTraceId] = str(trace_id)
        if expected_output is not None:
            self._expected_output = expected_output
        if disable_sending is not None and client is not None:
            client.disable_sending = disable_sending

        # Serialize metadata before setting as attribute
        if self.root_span is not None:
            self.root_span.set_attributes(
                {
                    "metadata": json.dumps(
                        metadata, cls=SerializableWithStringFallback
                    ),
                }
            )

        # Pre-serialize timestamps if present
        update_kwargs = {
            "name": name,
            "type": type,
            "input": input,
            "output": output,
            "error": error,
            "contexts": contexts,
            "model": model,
            "params": params,
            "metrics": metrics,
        }
        if timestamps is not None:
            update_kwargs["timestamps"] = json.dumps(
                timestamps, cls=SerializableWithStringFallback
            )

        if self.root_span is not None:
            self.root_span.update(**update_kwargs)

    @deprecated(
        reason="Evaluations should be actioned on the span object directly, not a trace. This method will be removed in a future version.",
    )
    def add_evaluation(
        self,
        *,
        evaluation_id: Optional[str] = None,
        span: Optional[LangWatchSpan] = None,
        name: str,
        type: Optional[str] = None,
        is_guardrail: Optional[bool] = None,
        status: Literal["processed", "skipped", "error"] = "processed",
        passed: Optional[bool] = None,
        score: Optional[float] = None,
        label: Optional[str] = None,
        details: Optional[str] = None,
        cost: Optional[Union[Money, MoneyDict, float]] = None,
        error: Optional[Exception] = None,
        timestamps: Optional[EvaluationTimestamps] = None,
    ):
        from langwatch import evaluations

        evaluations._add_evaluation(  # type: ignore
            span=span,
            evaluation_id=evaluation_id,
            name=name,
            type=type,
            is_guardrail=is_guardrail,
            status=status,
            passed=passed,
            score=score,
            label=label,
            details=details,
            cost=cost,
            error=error,
            timestamps=timestamps,
        )

    @deprecated(
        reason="Evaluations should be actioned on the span object directly, not a trace. This method will be removed in a future version.",
    )
    def evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        conversation: Optional[Conversation] = None,
        settings: Optional[Dict[str, Any]] = None,
        as_guardrail: bool = False,
        data: Optional[Union["BasicEvaluateData", Dict[str, Any]]] = None,
    ):
        from langwatch import evaluations

        return evaluations.evaluate(
            trace=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
            data=data,
        )

    @deprecated(
        reason="Evaluations should be actioned on the span object directly, not a trace. This method will be removed in a future version.",
    )
    async def async_evaluate(
        self,
        slug: str,
        name: Optional[str] = None,
        input: Optional[str] = None,
        output: Optional[str] = None,
        expected_output: Optional[str] = None,
        contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
        conversation: Optional[Conversation] = None,
        settings: Optional[Dict[str, Any]] = None,
        as_guardrail: bool = False,
        data: Optional[Union["BasicEvaluateData", Dict[str, Any]]] = None,
    ):
        from langwatch import evaluations

        return await evaluations.async_evaluate(
            trace=self,
            slug=slug,
            name=name,
            input=input,
            output=output,
            expected_output=expected_output,
            contexts=contexts,
            conversation=conversation,
            settings=settings,
            as_guardrail=as_guardrail,
            data=data,
        )

    def __call__(self, func: T) -> T:
        """Makes the trace callable as a decorator."""
        if inspect.isasyncgenfunction(func):

            @functools.wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self._clone() as trace:
                    trace._set_callee_input_information(func, *args, **kwargs)
                    items = []
                    async for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    trace._set_callee_output_information(func, output)

            return wrapper
        elif inspect.isgeneratorfunction(func):

            @functools.wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self._clone() as trace:
                    trace._set_callee_input_information(func, *args, **kwargs)
                    items = []
                    for item in func(*args, **kwargs):
                        items.append(item)
                        yield item

                    output = (
                        "".join(items)
                        if all(isinstance(item, str) for item in items)
                        else items
                    )
                    trace._set_callee_output_information(func, output)

            return wrapper
        elif inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self._clone() as trace:
                    trace._set_callee_input_information(func, *args, **kwargs)
                    output = await func(*args, **kwargs)
                    trace._set_callee_output_information(func, output)
                    return output

            return wrapper
        else:

            @functools.wraps(func)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                with self._clone() as trace:
                    trace._set_callee_input_information(func, *args, **kwargs)
                    output = func(*args, **kwargs)
                    trace._set_callee_output_information(func, output)
                    return output

            return wrapper

    def __enter__(self) -> "LangWatchTrace":
        """Makes the trace usable as a context manager."""
        self._reset()

        # Store the old token and set the new one
        self._context_token = langwatch.telemetry.context._set_current_trace(self)

        if self._root_span_params is not None:
            self._create_root_span()

        return self

    def __exit__(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> bool:
        """Exit the trace context, recording any errors that occurred."""
        try:
            if self.root_span is not None:
                self.root_span.__exit__(exc_type, exc_value, traceback)
        except Exception as e:
            warn(f"Failed to exit LangWatch trace: {e}")
        finally:
            self._cleanup(exc_type, exc_value, traceback)
        return False  # Don't suppress exceptions

    async def __aenter__(self) -> "LangWatchTrace":
        """Makes the trace usable as an async context manager."""
        self._reset()

        # Store the old token and set the new one
        self._context_token = langwatch.telemetry.context._set_current_trace(self)

        if self._root_span_params is not None:
            self._create_root_span()

        return self

    async def __aexit__(
        self,
        exc_type: Optional[type],
        exc_value: Optional[BaseException],
        traceback: Any,
    ) -> bool:
        """Exit the async trace context, recording any errors that occurred."""
        try:
            if self.root_span is not None:
                await self.root_span.__aexit__(exc_type, exc_value, traceback)
        except Exception as e:
            warn(f"Failed to exit LangWatch trace: {e}")
        finally:
            self._cleanup(exc_type, exc_value, traceback)
        return False  # Don't suppress exceptions

    def __del__(self):
        """Ensure trace context is cleaned up if object is garbage collected."""
        self._cleanup(None, None, None)

    def send_spans(self):
        trace_api.get_tracer_provider().force_flush()  # type: ignore

    def _set_callee_input_information(
        self, func: Callable[..., Any], *args: Any, **kwargs: Any
    ):
        """Set the name and input of the trace based on the callee function and arguments."""

        if self.root_span is None:
            warn(
                "Setting input information on a trace that has not been created yet is not possible. This is a bug, please report it."
            )
            return

        sig = inspect.signature(func)
        parameters = list(sig.parameters.values())

        all_args = {
            str(parameter.name): value for parameter, value in zip(parameters, args)
        }

        # Skip self parameters because it doesn't really help with debugging, becomes just noise
        if "self" in all_args and len(all_args) > 0 and parameters[0].name == "self":
            self_ = all_args["self"]
            if self.root_span.name is None:
                try:
                    self.root_span.update_name(
                        f"{self_.__class__.__name__}.{func.__name__}"
                    )
                except:
                    pass
            del all_args["self"]

        # Fallback to only the function name if no name is set
        if self.root_span.name is None:
            self.root_span.update_name(func.__name__)

        if self.root_span.capture_input is False or self.root_span.input is not None:
            return

        if kwargs and len(kwargs) > 0:
            if kwargs:
                all_args.update(kwargs)

        if len(all_args) == 0:
            return

        self.root_span.update(input=convert_typed_values(all_args))

    def _set_callee_output_information(self, func: Callable[..., Any], output: Any):
        """Set the output of the trace based on the callee function and output."""

        if self.root_span is None:
            warn(
                "Setting output information on a trace that has not been created yet is not possible. This is a bug, please report it."
            )
            return

        if self._root_span_params is not None:
            if self.root_span.name is None:
                self.root_span.update_name(func.__name__)

            if (
                self.root_span.capture_input is False
                or self.root_span.output is not None
            ):
                return

            self.root_span.update(output=convert_typed_values(output))

    @property
    def disable_sending(self) -> bool:
        """Get whether sending is disabled."""
        ensure_setup()
        client = get_instance()
        if client is None:
            return True
        return client.disable_sending

    @disable_sending.setter
    @deprecated(
        reason="Setting disable_sending on the trace is deprecated. Please set it on the LangWatch client instance instead using `langwatch.get_instance().disable_sending = True`"
    )
    def disable_sending(self, value: bool) -> None:
        """Set whether sending is disabled. This will also update the client's setting."""
        ensure_setup()
        client = get_instance()
        if client is not None:
            client.disable_sending = value

    @deprecated(
        reason="Setting the current span is deprecated, this call is now redundant as creating a new span will automatically set it as the current span."
    )
    def set_current_span(self, span: Any):
        self.current_span = span


def trace(
    trace_id: Optional[Union[str, UUID]] = None,
    metadata: Optional[TraceMetadata] = None,
    expected_output: Optional[str] = None,
    api_key: Optional[str] = None,
    disable_sending: bool = False,
    max_string_length: Optional[int] = 5000,
    # Root span parameters
    span_id: Optional[str] = None,
    capture_input: bool = True,
    capture_output: bool = True,
    name: Optional[str] = None,
    type: SpanTypes = "span",
    input: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
    output: Optional[Union[SpanInputOutput, str, List[ChatMessage]]] = None,
    error: Optional[Exception] = None,
    timestamps: Optional[SpanTimestamps] = None,
    contexts: Optional[Union[List[RAGChunk], List[str]]] = None,
    model: Optional[str] = None,
    params: Optional[SpanParams] = None,
    metrics: Optional[SpanMetrics] = None,
    evaluations: Optional[List[Evaluation]] = None,
    skip_root_span: bool = False,
    tracer_provider: Optional[TracerProvider] = None,
) -> LangWatchTrace:
    """Create a new trace for tracking a complete request/response cycle.

    A trace represents a complete request/response cycle in your application.
    It can contain multiple spans representing different operations within that cycle.
    """
    # Ensure client is setup
    ensure_setup()
    if api_key is not None:
        warn(
            "Setting API key on trace is deprecated. Please set it on the LangWatch client instance instead using `langwatch.setup(api_key=<api_key>)`"
        )
        set_api_key(api_key=api_key)

    return LangWatchTrace(
        trace_id=trace_id,
        metadata=metadata,
        expected_output=expected_output,
        api_key=api_key,
        disable_sending=disable_sending,
        max_string_length=max_string_length,
        tracer_provider=tracer_provider,
        span_id=span_id,
        capture_input=capture_input,
        capture_output=capture_output,
        name=name,
        type=type,
        input=input,
        output=output,
        error=error,
        timestamps=timestamps,
        contexts=contexts,
        model=model,
        params=params,
        metrics=metrics,
        evaluations=evaluations,
        skip_root_span=skip_root_span,
    )
