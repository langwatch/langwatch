from collections import OrderedDict
from contextlib import asynccontextmanager, contextmanager
import asyncio
import math
import os
import signal
import sys
import threading
import time
import anyio.to_thread
import dotenv
import litellm
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
    size_thread_pool_for_evaluations()
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
# The two concurrency knobs multiply, because they count different things.
# The gate admits REQUESTS, and each admitted request fans its batch out to at
# most MAX_EVALUATIONS_IN_PARALLEL entries. With the defaults that is 64
# requests at once and up to 64 x 50 entry evaluations in flight. The batch
# executor starts a thread per submitted entry and only when it is submitted,
# so single-entry requests cost one thread each and the product is a ceiling,
# not a reservation. Lower MAX_EVALUATIONS_IN_PARALLEL to bound the width of
# every batch, and MAX_CONCURRENT_EVALUATIONS to bound how many run together.
MAX_EVALUATIONS_IN_PARALLEL = (
    positive_int_or_none(os.getenv("MAX_EVALUATIONS_IN_PARALLEL")) or 50
)
MAX_CONCURRENT_EVALUATIONS = (
    positive_int_or_none(os.getenv("MAX_CONCURRENT_EVALUATIONS")) or 64
)
# How long one request may hold its gate ticket. An evaluation waits on a
# model call, and a stalled call keeps its socket open for as long as the
# provider leaves it open, so without this bound a request can hold a slot for
# the life of the process. Enough stuck requests and the gate never admits
# anyone again: every caller waits out the queue timeout and gets
# "Evaluation queue is full", and only a restart clears it.
EVALUATION_TIMEOUT_SECONDS = (
    positive_float_or_none(os.getenv("LANGEVALS_EVALUATION_TIMEOUT")) or 300.0
)
# What one entry spends before it gives up on the provider. `evaluate_batch`
# retries a failed model call this many times and waits between attempts, and
# the server does not override either, so a stalled provider is dialled
# MODEL_CALL_ATTEMPTS times and not once.
MODEL_CALL_ATTEMPTS = 3
MODEL_CALL_MAX_WAIT_SECONDS = 10.0


def model_timeout_fitting_the_batch_deadline(batch_deadline: float) -> float:
    """The longest one model call may run and still lose the race.

    The batch deadline names nothing but the batch, so a call that stalls
    should fail first, as a provider timeout that names the provider. That
    only holds if EVERY attempt fits: one call under the deadline still ends
    as an abandoned batch when the retry after it is cut off. So the budget is
    all the attempts plus the waits between them, not one call.

    Capped at three minutes, which is far above any judge call that is working
    (single figures of seconds, or a minute for a reasoning model on a long
    context), so the bound only ever cuts off a call that stopped making
    progress.
    """
    waits = (MODEL_CALL_ATTEMPTS - 1) * MODEL_CALL_MAX_WAIT_SECONDS
    fits = math.floor((batch_deadline - waits) / MODEL_CALL_ATTEMPTS)
    return float(min(180, max(1, fits)))


# How long ONE model call may take, which is the usual reason an evaluation
# overruns. litellm ships a 6000 second default, so a stalled provider parks a
# worker thread for 100 minutes. The batch deadline above already gives the
# slot back at that point, but only this makes the abandoned thread die
# instead of lingering with the socket.
MODEL_TIMEOUT_SECONDS = positive_float_or_none(
    os.getenv("LANGEVALS_MODEL_TIMEOUT")
) or model_timeout_fitting_the_batch_deadline(EVALUATION_TIMEOUT_SECONDS)
litellm.request_timeout = MODEL_TIMEOUT_SECONDS
# Spare threads for anything the framework runs off the event loop that is not
# an evaluation. The pool is sized from the knob plus this, never below it.
THREAD_POOL_HEADROOM = 8


def size_thread_pool_for_evaluations() -> None:
    """Give the worker-thread pool room for every evaluation the gate admits.

    The evaluate endpoints are sync, so FastAPI runs them on AnyIO's shared
    worker-thread pool, which holds 40 threads by default. A request with no
    thread waits BEFORE it reaches the gate, where nothing knows its
    credentials, so a pool smaller than the gate would both cap the knob
    silently and decide the running order the gate is there to decide.
    Sizing the pool from the knob keeps the gate the only limit.
    """
    limiter = anyio.to_thread.current_default_thread_limiter()
    wanted = MAX_CONCURRENT_EVALUATIONS + THREAD_POOL_HEADROOM
    if limiter.total_tokens < wanted:
        limiter.total_tokens = wanted


class EvaluationQueueTimeout(Exception):
    """Raised when a request waited out the queue timeout without admission."""


class EvaluationGate:
    """Bounds how many evaluations run at once, first come first served.

    Credentials do not constrain admission: a request's `env` stays in its own
    evaluation context and reaches the model call as explicit arguments (see
    `langevals_core.request_env`), so evaluations with different credentials
    run together safely. What is left for the gate is overload protection:
    at most `max_concurrent` evaluations run, waiters are admitted strictly
    in arrival order, and a waiter that outlives `timeout_seconds` is
    rejected so its caller gets a clear signal instead of a stale result.

    One ticket covers one request, whatever the size of its batch. The width
    of a batch is `MAX_EVALUATIONS_IN_PARALLEL`, so the two knobs multiply,
    as the comment on them describes.
    """

    def __init__(
        self,
        max_concurrent: int,
        timeout_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._condition = threading.Condition()
        self._active = 0
        # Arrival-ordered tickets of the requests waiting for capacity.
        # Timed-out waiters remove their ticket, so an abandoned ticket can
        # never block the queue.
        self._waiting: OrderedDict[int, None] = OrderedDict()
        self._next_ticket = 0
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
    def waiting_evaluations(self) -> int:
        return len(self._waiting)

    def _may_admit(self, ticket: Optional[int]) -> bool:
        if self._active >= self._max_concurrent:
            return False
        front = next(iter(self._waiting), None)
        # Nobody may overtake the queue: with waiters present, only the
        # earliest ticket goes through.
        return front is None or front == ticket

    @contextmanager
    def admit(self):
        deadline = self._clock() + self._timeout_seconds
        with self._condition:
            ticket: Optional[int] = None
            try:
                while True:
                    # A queued request past its deadline is rejected even if
                    # capacity happens to free at that same moment: its
                    # caller already gave up, so running it would only delay
                    # the live requests behind it.
                    if ticket is not None and self._clock() >= deadline:
                        raise EvaluationQueueTimeout()
                    if self._may_admit(ticket):
                        break
                    if ticket is None:
                        ticket = self._next_ticket
                        self._next_ticket += 1
                        self._waiting[ticket] = None
                    self._condition.wait(deadline - self._clock())
            finally:
                if ticket is not None:
                    self._waiting.pop(ticket, None)
                    # The queue front may have changed; blocked waiters
                    # behind it must re-check instead of sitting out their
                    # own deadline.
                    self._condition.notify_all()
            self._active += 1
        try:
            yield
        finally:
            with self._condition:
                self._active -= 1
                self._warn_once_on_environment_drift()
                self._condition.notify_all()

    _drift_warned = False

    def _warn_once_on_environment_drift(self) -> None:
        """Tripwire for a writer regression, checked when the gate drains.

        No evaluation writes the process environment anymore; that is what
        makes different-credential evaluations safe to run together. If an
        evaluator or library starts writing again, concurrent requests could
        read each other's credentials, so make the regression visible. Warn
        rather than restore: rewriting os.environ while other evaluations run
        is exactly the class of mutation this server no longer does.
        """
        if self._active > 0 or EvaluationGate._drift_warned:
            return
        if dict(os.environ) != original_env:
            EvaluationGate._drift_warned = True
            drifted = {
                key
                for key in set(os.environ) | set(original_env)
                if os.environ.get(key) != original_env.get(key)
            }
            print(
                "WARNING: the process environment changed while evaluations "
                f"ran (keys: {', '.join(sorted(drifted))}). Evaluations must "
                "not write os.environ; check for a writer regression."
            )


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
            with evaluation_gate.admit():
                if module_name == "ragas":
                    nest_asyncio_if_running_loop()
                # The request env stays on the evaluator and is bound to each
                # entry's evaluation context; nothing about this request
                # touches os.environ, which is what lets requests with
                # different credentials run at the same time.
                evaluator = evaluator_cls(settings=(req.settings or {}), env=req.env)  # type: ignore
                return evaluator.evaluate_batch(
                    req.data,
                    max_evaluations_in_parallel=MAX_EVALUATIONS_IN_PARALLEL,
                    max_seconds=EVALUATION_TIMEOUT_SECONDS,
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
