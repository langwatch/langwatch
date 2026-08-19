"""Regression tests for concurrent evaluations and credential isolation.

The server used to run strictly one evaluation at a time per process, because
each request's `env` (the caller's model credentials) was written into
`os.environ` for litellm to read: two concurrent evaluations with different
credentials could read each other's. That made a burst of N judge evaluations
take N times the single-call latency: a customer's 46-call experiment against
a slow judge model took half an hour.

Now no evaluation touches `os.environ` at all. The request env is bound to the
evaluation's own context (`langevals_core.request_env`) and resolved into
explicit call arguments by the litellm patch layer, so evaluations run
together whatever credentials they carry, and the gate only bounds how many
run at once, first come first served.

These tests drive the real ASGI app in-process. The slow evaluator is
`langevals/exact_match` with its `evaluate` patched to sleep: `time.sleep`
releases the GIL, standing in for the network wait of a judge call without
any provider dependency.
"""

import asyncio
import os
import sys
import threading
import time

import anyio.to_thread
import httpx
import pytest

# Same import guard as test_server_responsiveness (they must agree, since the
# first of the two files pytest collects is the one that actually imports the
# module): `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD at
# import time, and both are restored right after.
_original_argv = sys.argv
_original_preload = os.environ.get("DISABLE_EVALUATORS_PRELOAD")
sys.argv = ["server.py", "--only", "langevals,ragas"]
os.environ["DISABLE_EVALUATORS_PRELOAD"] = "1"
try:
    from langevals import server
finally:
    sys.argv = _original_argv
    if _original_preload is None:
        os.environ.pop("DISABLE_EVALUATORS_PRELOAD", None)
    else:
        os.environ["DISABLE_EVALUATORS_PRELOAD"] = _original_preload

# The server captured original_env while the temporary preload flag was set,
# and the drift tripwire compares against that snapshot. Rebase it on the
# clean environment so the flag cannot read as drift.
server.original_env = os.environ.copy()


class ManualClock:
    """A monotonic clock the test moves by hand.

    Real time cannot produce one of the cases the gate has to handle: a
    request that is still queued after its deadline passed. On a real clock
    such a waiter wakes on its own timeout the moment the deadline passes, so
    capacity can never free while it is both queued and expired. Advancing
    this clock puts the blocked waiter past its deadline first, and the
    release then follows.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._now = 0.0

    def __call__(self) -> float:
        with self._lock:
            return self._now

    def advance(self, seconds: float) -> None:
        with self._lock:
            self._now += seconds


# AnyIO's default worker-thread pool, which is what caps sync endpoints
# until the server sizes it for the gate.
ANYIO_DEFAULT_THREAD_POOL = 40


def wait_until(condition, description: str, timeout: float = 5) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() >= deadline:
            pytest.fail(f"{description} within {timeout}s")
        time.sleep(0.005)


@pytest.fixture
def slow_exact_match(monkeypatch):
    from langevals_langevals.exact_match import ExactMatchEvaluator

    observations: list[dict] = []
    original_evaluate = ExactMatchEvaluator.evaluate

    def slow_evaluate(self, entry):
        started = time.monotonic()
        time.sleep(0.8)
        observations.append(
            {
                "started": started,
                "finished": time.monotonic(),
                # The credential this evaluation received, and what the
                # process environment held while it ran. The first must be
                # the request's own; the second must never hold any
                # request's.
                "request_key": (self.env or {}).get("OPENAI_API_KEY"),
                "global_key": os.environ.get("OPENAI_API_KEY"),
            }
        )
        return original_evaluate(self, entry)

    monkeypatch.setattr(ExactMatchEvaluator, "evaluate", slow_evaluate)
    return observations


def evaluation_request(env: dict) -> dict:
    return {
        "data": [{"output": "42", "expected_output": "42"}],
        "settings": {},
        "env": env,
    }


@pytest.mark.anyio
async def test_same_env_evaluations_run_concurrently(slow_exact_match):
    transport = httpx.ASGITransport(app=server.app)
    env = {"OPENAI_API_KEY": "same-key-for-both"}
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        start = time.monotonic()
        responses = await asyncio.gather(
            *(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request(env),
                )
                for _ in range(4)
            )
        )
        wall = time.monotonic() - start

    assert all(r.status_code == 200 for r in responses)
    assert len(slow_exact_match) == 4
    # Four 0.8s evaluations must overlap: serialized they would take at
    # least 3.2s.
    assert wall < 2.4


@pytest.mark.anyio
async def test_different_env_evaluations_run_concurrently_without_crossing(
    slow_exact_match,
):
    """Different credentials no longer serialize, and never cross.

    This is the inversion of the old contract: when request credentials were
    written into os.environ, overlapping two tenants would have swapped their
    keys mid-call, so the server serialized them. With credentials bound to
    each evaluation's own context, the two tenants must overlap, each must
    see exactly its own key, and neither key may ever appear in the process
    environment.
    """
    transport = httpx.ASGITransport(app=server.app)
    tenant_keys = {"tenant-a-key", "tenant-b-key"}
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        start = time.monotonic()
        responses = await asyncio.gather(
            *(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request({"OPENAI_API_KEY": key}),
                )
                for key in sorted(tenant_keys)
            )
        )
        wall = time.monotonic() - start

    assert all(r.status_code == 200 for r in responses)
    assert len(slow_exact_match) == 2
    first, second = sorted(slow_exact_match, key=lambda o: o["started"])
    # They overlapped: the second started before the first finished, and the
    # pair beat the 1.6s serial floor.
    assert second["started"] < first["finished"]
    assert wall < 1.5
    # Each evaluation carried its own credential, and no request credential
    # ever reached the process environment.
    assert {first["request_key"], second["request_key"]} == tenant_keys
    assert first["global_key"] not in tenant_keys
    assert second["global_key"] not in tenant_keys


@pytest.mark.anyio
async def test_the_process_environment_is_never_touched(slow_exact_match):
    def without_pytest_marker(env: dict) -> dict:
        # PYTEST_CURRENT_TEST is pytest's own per-phase marker and changes
        # under our feet; everything else must be byte-identical.
        return {k: v for k, v in env.items() if k != "PYTEST_CURRENT_TEST"}

    before = without_pytest_marker(dict(os.environ))
    transport = httpx.ASGITransport(app=server.app)
    env = {"OPENAI_API_KEY": "must-never-enter-the-environment"}
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        await asyncio.gather(
            *(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request(env),
                )
                for _ in range(3)
            )
        )

    assert without_pytest_marker(dict(os.environ)) == before


@pytest.mark.anyio
async def test_the_thread_pool_has_room_for_every_evaluation_the_gate_admits():
    limiter = anyio.to_thread.current_default_thread_limiter()
    assert limiter.total_tokens == ANYIO_DEFAULT_THREAD_POOL
    async with server.lifespan(server.app):
        assert limiter.total_tokens >= server.MAX_CONCURRENT_EVALUATIONS


@pytest.mark.anyio
async def test_a_burst_wider_than_the_default_thread_pool_runs_together(
    slow_exact_match,
):
    """The knob decides the width, not the framework's thread pool.

    Sync endpoints run on AnyIO's worker threads, and a request with no
    thread waits before it reaches the gate. With the pool left at its
    default the gate could never admit more than 40 evaluations whatever the
    knob said, and the requests above that would queue where the gate cannot
    order them.
    """
    if server.MAX_CONCURRENT_EVALUATIONS <= ANYIO_DEFAULT_THREAD_POOL:
        pytest.skip("the knob is below the default pool, so there is nothing to prove")

    burst = ANYIO_DEFAULT_THREAD_POOL + 8
    env = {"OPENAI_API_KEY": "one-tenant"}
    peak = 0

    async def sample_active():
        nonlocal peak
        while True:
            peak = max(peak, server.evaluation_gate.active_evaluations)
            await asyncio.sleep(0.005)

    transport = httpx.ASGITransport(app=server.app)
    async with server.lifespan(server.app):
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test", timeout=120
        ) as client:
            sampler = asyncio.create_task(sample_active())
            try:
                responses = await asyncio.gather(
                    *(
                        client.post(
                            "/langevals/exact_match/evaluate",
                            json=evaluation_request(env),
                        )
                        for _ in range(burst)
                    )
                )
            finally:
                sampler.cancel()

    assert all(r.status_code == 200 for r in responses)
    assert len(slow_exact_match) == burst
    assert peak > ANYIO_DEFAULT_THREAD_POOL


def test_admissions_run_in_arrival_order():
    """Waiters are admitted first come first served, never overtaken."""
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=30)
    entered: list[str] = []
    entered_lock = threading.Lock()
    releases = {name: threading.Event() for name in ("holder", "second", "third")}
    threads: dict[str, threading.Thread] = {}

    def run(name: str) -> None:
        with gate.admit():
            with entered_lock:
                entered.append(name)
            releases[name].wait(5)

    def start(name: str) -> None:
        threads[name] = threading.Thread(target=run, args=(name,))
        threads[name].start()

    start("holder")
    wait_until(lambda: gate.active_evaluations == 1, "The holder was not admitted")
    start("second")
    wait_until(lambda: gate.waiting_evaluations == 1, "The second never queued")
    start("third")
    wait_until(lambda: gate.waiting_evaluations == 2, "The third never queued")

    releases["holder"].set()
    wait_until(lambda: "second" in entered, "The second was not admitted")
    # The third is still waiting: capacity is 1 and the second holds it.
    assert "third" not in entered
    releases["second"].set()
    wait_until(lambda: "third" in entered, "The third was not admitted")
    releases["third"].set()

    for name, thread in threads.items():
        thread.join(timeout=5)
        assert not thread.is_alive(), f"{name} never finished"
    assert entered == ["holder", "second", "third"]
    assert gate.active_evaluations == 0
    assert gate.waiting_evaluations == 0


def test_gate_times_out_with_a_clear_error():
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=0.05)
    with gate.admit():
        with pytest.raises(server.EvaluationQueueTimeout):
            with gate.admit():
                pass


def test_capacity_freed_after_the_deadline_does_not_admit():
    clock = ManualClock()
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=30, clock=clock)
    release = threading.Event()
    late_outcome: list[str] = []

    def holder():
        with gate.admit():
            release.wait(5)

    def late_request():
        try:
            with gate.admit():
                late_outcome.append("admitted")
        except server.EvaluationQueueTimeout:
            late_outcome.append("timed out")

    holding = threading.Thread(target=holder)
    holding.start()
    wait_until(lambda: gate.active_evaluations == 1, "The holder was not admitted")

    waiting = threading.Thread(target=late_request)
    waiting.start()
    wait_until(
        lambda: gate.waiting_evaluations == 1,
        "The late request never queued",
    )

    # The deadline of the queued request passes BEFORE the capacity it waits
    # for frees. Its caller already gave up, so the gate must reject it
    # instead of starting it now and delaying the live requests behind it.
    clock.advance(31)
    release.set()

    waiting.join(timeout=5)
    holding.join(timeout=5)
    assert not waiting.is_alive()
    assert not holding.is_alive()
    assert late_outcome == ["timed out"]
    assert gate.waiting_evaluations == 0
    assert gate.active_evaluations == 0
    # The gate is healthy afterwards: a fresh request admits immediately.
    with gate.admit():
        assert gate.active_evaluations == 1
