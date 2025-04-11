import asyncio
import time
import threading
from typing import TypeVar, cast
import dspy

from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule

from langwatch_nlp.studio.field_parser import with_autoparsing
from langwatch_nlp.studio.dspy.patched_optional_image import patch_optional_image
from dspy.utils.callback import with_callbacks


patch_optional_image()

T = TypeVar("T", bound=dspy.Module)


class LangWatchWorkflowModule(ReportingModule):
    cost: float = 0
    duration: int = 0

    def __init__(self, run_evaluations: bool = False, *args, **kwargs):
        super().__init__(*args, **kwargs)

    @with_callbacks
    def __call__(self, *args, **kwargs):
        # We have to do this hack to de-asyncify the forward method
        # because dspy Evaluate which is used on evaluation and optimization
        # expects only a synchronous function, but we still want to be able to
        # run nodes in parallel
        if asyncio.iscoroutinefunction(self.forward):
            coroutine = self.forward(*args, **kwargs)

            try:
                # Check if there's a running event loop
                asyncio.get_running_loop()
                # We're in an async context - we need to run this in a separate thread
                # because we can't block the current event loop
                return self._run_in_thread(coroutine)
            except RuntimeError:
                # No running event loop, create a new one
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    result = loop.run_until_complete(coroutine)
                finally:
                    loop.close()
                return result
        else:
            return self.forward(*args, **kwargs)

    def _run_in_thread(self, coroutine):
        """Run a coroutine in a separate thread with its own event loop."""
        result_container = []
        exception_container = []

        def thread_target():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(coroutine)
                result_container.append(result)
            except Exception as e:
                exception_container.append(e)
            finally:
                loop.close()

        thread = threading.Thread(target=thread_target)
        thread.start()
        thread.join()

        if exception_container:
            raise exception_container[0]
        return result_container[0]

    async def forward(self, *args, **kwargs):
        raise NotImplementedError("This method should be implemented by the subclass")

    def wrapped(self, module: T, node_id: str, run: bool = True) -> T:
        module_ = dspy.asyncify(
            self.with_reporting(with_autoparsing(module), node_id)  # type: ignore
        )

        async def wrapper(*args, **kwargs):
            if not run:
                return EvaluationResultWithMetadata(
                    status="skipped",
                    details=f"Node {node_id} skipped",
                    inputs=kwargs,
                    duration=0,
                )

            start_time = time.time()
            try:
                result = await module_(*args, **kwargs)
                # Skip cost and duration calculation for evaluation results as those are counted separately
                if not isinstance(result, PredictionWithEvaluationAndMetadata):
                    self.cost += getattr(result, "cost", None) or 0
                    self.duration += round(time.time() - start_time)
            except Exception as e:
                self.duration += round(time.time() - start_time)
                raise e
            return result

        return cast(T, wrapper)
