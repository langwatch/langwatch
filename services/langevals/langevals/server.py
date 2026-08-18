from collections import OrderedDict
from contextlib import asynccontextmanager, contextmanager
import asyncio
import os
import signal
import sys
import threading
import time
import dotenv
from fastapi.responses import RedirectResponse

from langevals.staged_payload import StagedPayloadMiddleware
from langevals.utils import (
    get_cpu_count,
    get_evaluator_classes,
    get_evaluator_definitions,
    load_evaluator_packages,
    positive_float_or_none,
    positive_int_or_none,
)

dotenv.load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from typing import Callable, List, Optional
from langevals_core.base_evaluator import (
    EvaluationResultSkipped,
    EvaluationResultError,
    models_env_vars,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from mangum import Mangum

import nest_asyncio

nest_asyncio_apply = nest_asyncio.apply
nest_asyncio.apply = lambda: None


def handle_sigterm(signum, frame):
    print("Received SIGTERM")
    raise SystemExit(0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("RUNNING_IN_DOCKER"):
        signal.signal(signal.SIGTERM, handle_sigterm)
        signal.signal(signal.SIGINT, handle_sigterm)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(StagedPayloadMiddleware)

original_env = os.environ.copy()

# The knobs are read while the server boots: a blank or mistyped value in a
# manifest falls back to the default instead of stopping the pod.
EVALUATION_QUEUE_TIMEOUT_SECONDS = (
    positive_float_or_none(os.getenv("LANGEVALS_QUEUE_TIMEOUT")) or 300.0
)
MAX_EVALUATIONS_IN_PARALLEL = (
    positive_int_or_none(os.getenv("MAX_EVALUATIONS_IN_PARALLEL")) or 50
)
MAX_CONCURRENT_EVALUATIONS = (
    positive_int_or_none(os.getenv("MAX_CONCURRENT_EVALUATIONS")) or 8
)


def model_env_key(env: Optional[dict[str, str]]) -> tuple:
    """The part of a request's `env` that gets written into `os.environ`.

    Mirrors the filter in `BaseEvaluator.set_model_envs`: model provider
    credentials and litellm passthrough variables. Two requests with the same
    key write the same process environment, so they can run at the same time.
    """
    if not env:
        return ()
    return tuple(
        sorted(
            (key, value)
            for key, value in env.items()
            if key in models_env_vars or key.startswith("X_LITELLM_")
        )
    )


class EvaluationQueueTimeout(Exception):
    """Raised when a request waited out the queue timeout without admission."""


class EvaluationGate:
    """Admits evaluations concurrently while they share one environment.

    Evaluations write their request `env` into `os.environ` because litellm
    reads credentials implicitly, so two evaluations with different
    credentials must never overlap. Two evaluations with the same credentials
    write identical values, so they can, and on a single-project install
    (where every request carries the same provider keys) that is every
    evaluation. The gate tracks the env of the in-flight evaluations as a
    generation: same-env requests run together up to `max_concurrent`, and
    waiters queue per env key in arrival order. As soon as any request waits,
    the running generation stops admitting new entries, so a steady stream
    with one env cannot starve the others: generations run strictly in the
    order their first waiter arrived. The process environment is restored
    once the last evaluation of a generation leaves.
    """

    def __init__(
        self,
        max_concurrent: int,
        timeout_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._condition = threading.Condition()
        self._active = 0
        self._key: Optional[tuple] = None
        # Waiting env keys in first-arrival order, each with its waiter
        # count. Timed-out waiters remove themselves, so a key nobody waits
        # for anymore can never block the queue.
        self._waiting: OrderedDict[tuple, int] = OrderedDict()
        self._max_concurrent = max_concurrent
        self._timeout_seconds = timeout_seconds
        # The queue deadline reads the clock through this attribute, so a
        # test can move a blocked waiter past its deadline at a chosen
        # moment and check what the gate does when capacity frees after it.
        self._clock = clock

    @property
    def active_evaluations(self) -> int:
        return self._active

    @property
    def waiting_environments(self) -> list[tuple]:
        return list(self._waiting)

    @property
    def waiting_evaluations(self) -> int:
        return sum(self._waiting.values())

    def _may_admit(self, key: tuple) -> bool:
        if self._active >= self._max_concurrent:
            return False
        front = next(iter(self._waiting), None)
        if front is not None and front != key:
            return False
        # Either join the open generation with the same env, or start a new
        # generation on a drained gate.
        return self._key == key or self._key is None

    def _leave_queue(self, key: tuple) -> None:
        remaining = self._waiting.get(key, 0) - 1
        if remaining > 0:
            self._waiting[key] = remaining
        else:
            self._waiting.pop(key, None)
            # The queue front may have changed; blocked waiters of the next
            # key must re-check instead of sitting out their own deadline.
            self._condition.notify_all()

    @contextmanager
    def admit(self, key: tuple):
        deadline = self._clock() + self._timeout_seconds
        with self._condition:
            is_queued = False
            try:
                while True:
                    # A queued request past its deadline is rejected even if
                    # capacity happens to free at that same moment: its
                    # caller already gave up, so running it would only delay
                    # the live requests behind it.
                    if is_queued and self._clock() >= deadline:
                        raise EvaluationQueueTimeout()
                    if self._may_admit(key):
                        break
                    if not is_queued:
                        self._waiting[key] = self._waiting.get(key, 0) + 1
                        is_queued = True
                    self._condition.wait(deadline - self._clock())
            finally:
                if is_queued:
                    self._leave_queue(key)
            self._key = key
            self._active += 1
        try:
            yield
        finally:
            with self._condition:
                self._active -= 1
                if self._active == 0:
                    # Drop the request credentials (and anything an evaluator
                    # library set) the moment nothing is running anymore.
                    os.environ.clear()
                    os.environ.update(original_env)
                    self._key = None
                self._condition.notify_all()


evaluation_gate = EvaluationGate(
    max_concurrent=MAX_CONCURRENT_EVALUATIONS,
    timeout_seconds=EVALUATION_QUEUE_TIMEOUT_SECONDS,
)


def nest_asyncio_if_running_loop():
    """Apply nest_asyncio only when the caller is on a running event loop.

    Ragas evaluators drive their own asyncio loops; when this code ran on the
    server's event loop they could only nest with nest_asyncio. In a worker
    thread there is no running loop to nest into, and applying would raise.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return
    nest_asyncio_apply()


def create_evaluator_routes(evaluator_cls):
    definitions = get_evaluator_definitions(evaluator_cls)
    module_name = definitions.module_name
    evaluator_name = definitions.evaluator_name
    entry_type = definitions.entry_type
    settings_type = definitions.settings_type
    result_type = definitions.result_type

    required_env_vars = (
        "\n\n__Env vars:__ " + ", ".join(definitions.env_vars)
        if len(definitions.env_vars) > 0
        else ""
    )
    docs_url = "\n\n__Docs:__ " + definitions.docs_url if definitions.docs_url else ""
    description = definitions.description + required_env_vars + docs_url

    class Request(BaseModel):
        model_config = ConfigDict(extra="forbid")

        data: List[entry_type] = Field(description="List of entries to be evaluated, check the field type for the necessary keys")  # type: ignore
        settings: Optional[settings_type] = Field(None, description="Evaluator settings, check the field type for what settings this evaluator supports")  # type: ignore
        env: Optional[dict[str, str]] = Field(
            None,
            description="Optional environment variables to override the server ones",
            json_schema_extra={"example": {}},
        )

    if not os.getenv("DISABLE_EVALUATORS_PRELOAD"):
        evaluator_cls.preload()

    @app.post(
        f"/{module_name}/{evaluator_name}/evaluate",
        name=f"{module_name}_{evaluator_name}_evaluate",
        description=description,
    )
    def evaluate(
        req: Request,
    ) -> List[result_type | EvaluationResultSkipped | EvaluationResultError]:  # type: ignore
        # Sync endpoint: FastAPI runs it in a worker thread, so a long
        # evaluation never blocks the event loop and /healthcheck stays
        # responsive under load.
        try:
            with evaluation_gate.admit(model_env_key(req.env)):
                if module_name == "ragas":
                    nest_asyncio_if_running_loop()
                # Constructing the evaluator writes the request env into
                # os.environ (set_model_envs). Everything admitted together
                # carries the same key, so concurrent writes are identical.
                evaluator = evaluator_cls(settings=(req.settings or {}), env=req.env)  # type: ignore
                return evaluator.evaluate_batch(
                    req.data,
                    max_evaluations_in_parallel=MAX_EVALUATIONS_IN_PARALLEL,
                )
        except EvaluationQueueTimeout:
            raise HTTPException(
                status_code=503,
                detail="Evaluation queue is full, retry in a moment",
            )


evaluators = load_evaluator_packages()
for evaluator_name, evaluator_package in evaluators.items():
    module_name = evaluator_package.__name__.split("langevals_")[1]
    if (
        len(sys.argv) > 2
        and sys.argv[1] == "--only"
        and module_name not in sys.argv[2].split(",")
    ):
        continue
    print(f"Loading {evaluator_package.__name__}")
    for evaluator_cls in get_evaluator_classes(evaluator_package):
        create_evaluator_routes(evaluator_cls)


# Special-case: topic_clustering is a langevals workspace member but does
# NOT fit the per-trace evaluator interface (it's a batch operation that
# returns topics + assignments, not a per-trace score). It registers its
# own /topics/batch_clustering and /topics/incremental_clustering routes
# via a register_routes(app) hook. Imported conditionally so per-evaluator
# Lambda builds (--extra azure / openai / ragas / …) that don't include
# topic_clustering keep working.
def _maybe_register_topic_clustering_routes() -> None:
    only_filter = (
        sys.argv[2].split(",")
        if len(sys.argv) > 2 and sys.argv[1] == "--only"
        else None
    )
    if only_filter is not None and "topic_clustering" not in only_filter:
        return
    try:
        from langevals_topic_clustering import register_routes as _register
    except ImportError:
        # Package not installed in this build; skip silently — matches the
        # per-evaluator deploy model where each Lambda only ships one extra.
        return
    print("Loading langevals_topic_clustering (special routes)")
    _register(app)


_maybe_register_topic_clustering_routes()


@app.get("/healthcheck")
async def healthcheck():
    return {"status": "healthy"}


@app.get("/")
async def redirect_to_docs():
    return RedirectResponse(url="/docs")


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    raise HTTPException(
        status_code=400,
        detail=exc.errors(),
    )


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--preload":
        print("Preloading done")
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--export-openapi-json":
        import json

        with open("openapi.json", "w") as f:
            f.write(json.dumps(app.openapi(), indent=2))
        print("openapi.json exported")
        return
    host = "0.0.0.0"
    port = int(os.getenv("PORT", 5562))

    if sys.platform == "darwin":
        import uvicorn

        print(f"LangEvals listening at http://{host}:{port}")

        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="warning",
            timeout_keep_alive=900,
        )
    else:
        import gunicorn.app.base

        workers = get_cpu_count()

        class StandaloneApplication(gunicorn.app.base.BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                config = {
                    key: value
                    for key, value in self.options.items()
                    if key in self.cfg.settings and value is not None
                }  # type: ignore
                for key, value in config.items():
                    self.cfg.set(key.lower(), value)  # type: ignore

            def load(self):
                print(f"LangEvals listening at http://{host}:{port}")
                return self.application

        print(f"Starting server with {workers} workers")

        options = {
            "bind": f"{host}:{port}",
            "workers": workers,
            "worker_class": "uvicorn.workers.UvicornWorker",
            "preload_app": True,
            "forwarded_allow_ips": "*",
            "loglevel": "warning",
            "timeout": 900,
        }

        StandaloneApplication(app, options).run()


if __name__ == "__main__":
    main()
else:
    handler = Mangum(app, lifespan="off")
