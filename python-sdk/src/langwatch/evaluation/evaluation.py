from __future__ import annotations
import concurrent.futures
import asyncio
import json
import pandas as pd
from opentelemetry import trace
from typing import (
    Any,
    AsyncGenerator,
    AsyncIterator,
    Dict,
    Iterable,
    Optional,
    Tuple,
    TypeVar,
)

from langwatch.attributes import AttributeKey
from langwatch.domain import TypedValueJson
from langwatch.utils.transformation import (
    SerializableWithStringFallback,
    truncate_object_recursively,
    convert_typed_values,
)

from .tracer import tracer

IndexT = TypeVar("IndexT")
RowT = TypeVar("RowT", bound=pd.Series)


class Evaluation:
    def __init__(self, name: str):
        self.name: str = name

    def loop(
        self,
        iterable: Iterable[Tuple[IndexT, RowT]],
        *,
        threads: int = 1,
    ) -> AsyncIterator[Tuple[IndexT, RowT]]:
        with tracer.start_as_current_span(
            name="evaluation.loop",
            attributes={
                "evaluation_name": self.name,
                "evaluation_thread_count": threads,
            },
        ):

            async def _gen() -> AsyncGenerator[Tuple[IndexT, RowT], None]:
                with tracer.start_as_current_span(
                    name="evaluation.loop.iteration"
                ) as span:
                    it = iter(iterable)
                    loop = asyncio.get_running_loop()

                    with concurrent.futures.ThreadPoolExecutor(
                        max_workers=threads
                    ) as pool:
                        while True:
                            try:
                                item = await loop.run_in_executor(pool, next, it)
                            except StopIteration:
                                break
                            except Exception as e:
                                span.record_exception(e)
                                raise e
                            else:
                                yield item

        return _gen()

    def log(
        self,
        evaluator_name: str,
        index: int,
        data: Dict[str, Any],
        score: float,
        passed: bool,
        cost_cents: int,
        error: Optional[Exception] = None,
    ):
        span = trace.get_current_span()
        span.add_event(
            AttributeKey.LangWatchEventEvaluationLog,
            attributes={
                "evaluator_name": evaluator_name,
                "index": index,
                "data": json.dumps(
                    truncate_object_recursively(convert_typed_values(data)),
                    cls=SerializableWithStringFallback,
                ),
                "score": score,
                "passed": passed,
                "cost_cents": cost_cents,
                "error": json.dumps(
                    truncate_object_recursively(
                        TypedValueJson(
                            type="json",
                            value={
                                "status": "error",
                                "error": error,
                            },
                        ),
                    ),
                    cls=SerializableWithStringFallback,
                ),
            },
        )

    def run(
        self,
        evaluator_name: str,
        data: Dict[str, Any],
        settings: Dict[str, Any],
    ):
        pass
