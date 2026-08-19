"""Regression tests for concurrent evaluations sharing one environment.

The server used to run strictly one evaluation at a time per process, because
each request's `env` (the caller's model credentials) is written into
`os.environ` for litellm to read. That made a burst of N judge evaluations
take N times the single-call latency: a customer's 46-call experiment against
a slow judge model took half an hour. Requests that carry the SAME
credentials write identical values though, so they can safely overlap. The
gate admits same-env evaluations together and only serializes generations
with different envs.

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
# and the gate restores that snapshot after every burst. Rebase it on the
# clean environment so the restore cannot leak the flag into other tests.
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
                "openai_key": os.environ.get("OPENAI_API_KEY"),
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
    # Four 0.8s evaluations sharing one env must overlap: serialized they
    # would take at least 3.2s.
    assert wall < 2.4


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


@pytest.mark.anyio
async def test_different_env_evaluations_never_overlap(slow_exact_match):
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        responses = await asyncio.gather(
            *(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request({"OPENAI_API_KEY": key}),
                )
                for key in ("tenant-a-key", "tenant-b-key")
            )
        )

    assert all(r.status_code == 200 for r in responses)
    assert len(slow_exact_match) == 2
    first, second = sorted(slow_exact_match, key=lambda o: o["started"])
    # The second tenant's evaluation must not start until the first tenant's
    # generation drained: overlapping them would swap credentials mid-call.
    assert second["started"] >= first["finished"]
    # And each evaluation saw its own credentials in the process env.
    assert {first["openai_key"], second["openai_key"]} == {
        "tenant-a-key",
        "tenant-b-key",
    }


@pytest.mark.anyio
async def test_different_credentials_outside_the_provider_lists_never_overlap(
    slow_exact_match,
):
    """A variable no provider list covers still separates two requests.

    `set_model_envs` is not the only writer of the process environment: the
    custom LLM evaluators and every Ragas evaluator copy the whole request
    env into `os.environ` while they run. Bedrock credentials travel that
    way, so two tenants that differ only in an AWS variable would overwrite
    each other if the gate let them share a generation.
    """
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        responses = await asyncio.gather(
            *(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request(
                        {
                            "AWS_ACCESS_KEY_ID": f"{tenant}-id",
                            "AWS_SECRET_ACCESS_KEY": f"{tenant}-secret",
                        }
                    ),
                )
                for tenant in ("tenant-a", "tenant-b")
            )
        )

    assert all(r.status_code == 200 for r in responses)
    assert len(slow_exact_match) == 2
    first, second = sorted(slow_exact_match, key=lambda o: o["started"])
    assert second["started"] >= first["finished"]


@pytest.mark.anyio
async def test_environment_is_restored_after_the_burst(slow_exact_match):
    expected_env = dict(os.environ)
    transport = httpx.ASGITransport(app=server.app)
    env = {"OPENAI_API_KEY": "must-not-outlive-the-burst"}
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

    # The whole environment, not just the injected credential, is back to its
    # pre-burst state. PYTEST_CURRENT_TEST is pytest's own per-phase marker:
    # it was set after the server captured its baseline, so the restore
    # legitimately drops it and pytest re-sets it on the next phase.
    def without_pytest_marker(env: dict) -> dict:
        return {k: v for k, v in env.items() if k != "PYTEST_CURRENT_TEST"}

    assert without_pytest_marker(dict(os.environ)) == without_pytest_marker(
        expected_env
    )


@pytest.mark.anyio
async def test_waiting_environment_runs_before_later_requests_for_the_old_one(
    slow_exact_match,
):
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:

        def post(key: str):
            return asyncio.create_task(
                client.post(
                    "/langevals/exact_match/evaluate",
                    json=evaluation_request({"OPENAI_API_KEY": key}),
                )
            )

        first_generation = [post("tenant-a-key") for _ in range(2)]
        deadline = time.monotonic() + 5
        while server.evaluation_gate.active_evaluations == 0:
            if time.monotonic() >= deadline:
                pytest.fail("The first generation was not admitted within 5s")
            await asyncio.sleep(0.01)

        tenant_b = post("tenant-b-key")
        deadline = time.monotonic() + 5
        while not server.evaluation_gate.waiting_environments:
            if time.monotonic() >= deadline:
                pytest.fail("The waiting environment never queued within 5s")
            await asyncio.sleep(0.01)

        # Arrives while tenant B is already waiting, so it must queue BEHIND
        # tenant B even though its env matches the running generation.
        late_tenant_a = post("tenant-a-key")

        responses = await asyncio.gather(
            *first_generation, tenant_b, late_tenant_a
        )

    assert all(r.status_code == 200 for r in responses)
    by_key: dict[str, list[dict]] = {}
    for observation in slow_exact_match:
        by_key.setdefault(observation["openai_key"], []).append(observation)
    b_evaluation = by_key["tenant-b-key"][0]
    late_a_started = max(o["started"] for o in by_key["tenant-a-key"])
    # Generations run in first-waiter order: B before the A request that
    # queued after it, with no overlap between the generations.
    assert b_evaluation["started"] < late_a_started
    assert late_a_started >= b_evaluation["finished"]


def test_gate_times_out_with_a_clear_error():
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=0.05)
    with gate.admit(()):
        with pytest.raises(server.EvaluationQueueTimeout):
            with gate.admit((("OPENAI_API_KEY", "other"),)):
                pass


def test_capacity_freed_after_the_deadline_does_not_admit():
    clock = ManualClock()
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=30, clock=clock)
    release = threading.Event()
    late_key = (("OPENAI_API_KEY", "late"),)
    late_outcome: list[str] = []

    def holder():
        with gate.admit(()):
            release.wait(5)

    def late_request():
        try:
            with gate.admit(late_key):
                late_outcome.append("admitted")
        except server.EvaluationQueueTimeout:
            late_outcome.append("timed out")

    holding = threading.Thread(target=holder)
    holding.start()
    wait_until(lambda: gate.active_evaluations == 1, "The holder was not admitted")

    waiting = threading.Thread(target=late_request)
    waiting.start()
    wait_until(
        lambda: gate.waiting_environments == [late_key],
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
    assert gate.waiting_environments == []
    assert gate.active_evaluations == 0
    # The gate is healthy afterwards: a fresh request admits immediately.
    with gate.admit((("OPENAI_API_KEY", "fresh"),)):
        assert gate.active_evaluations == 1


def test_a_repeating_environment_cannot_hold_the_queue_front():
    """A request joins a queued generation of its own env, but not a running one.

    Requests that arrive while their own env is still queued join that
    queued generation, because batching same-env work is what the gate is
    for. That costs the env behind them one generation, never more: the
    moment the generation starts, its waiters leave the queue and the front
    belongs to the next env, so every later request of the running env
    queues behind it. A repeating env therefore cannot hold the front.
    """
    gate = server.EvaluationGate(max_concurrent=3, timeout_seconds=30)
    env_a = (("OPENAI_API_KEY", "a"),)
    env_b = (("OPENAI_API_KEY", "b"),)
    env_c = (("OPENAI_API_KEY", "c"),)
    entered: list[str] = []
    entered_lock = threading.Lock()
    releases = {name: threading.Event() for name in ("a", "b1", "b2", "c", "b3")}
    threads: dict[str, threading.Thread] = {}

    def entered_so_far() -> list[str]:
        with entered_lock:
            return list(entered)

    def start(name: str, key: tuple) -> None:
        def run():
            with gate.admit(key):
                with entered_lock:
                    entered.append(name)
                releases[name].wait(5)

        threads[name] = threading.Thread(target=run)
        threads[name].start()

    start("a", env_a)
    wait_until(lambda: gate.active_evaluations == 1, "A was not admitted")

    start("b1", env_b)
    wait_until(lambda: gate.waiting_environments == [env_b], "B never queued")
    start("c", env_c)
    wait_until(
        lambda: gate.waiting_environments == [env_b, env_c],
        "C never queued behind B",
    )
    # Arrives while B is still queued and C waits behind it, so it joins B's
    # queued generation instead of forming a third one after C.
    start("b2", env_b)
    wait_until(lambda: gate.waiting_evaluations == 3, "The second B never queued")

    releases["a"].set()
    wait_until(
        lambda: gate.active_evaluations == 2, "Both B requests did not run together"
    )

    # B is running now, so it no longer holds the queue front. This request
    # queues behind C even though its env matches the running generation and
    # the gate still has spare capacity.
    start("b3", env_b)
    wait_until(
        lambda: gate.waiting_environments == [env_c, env_b],
        "The late B never queued behind C",
    )

    releases["b1"].set()
    releases["b2"].set()
    wait_until(lambda: "c" in entered_so_far(), "C did not run after B drained")
    releases["c"].set()
    wait_until(lambda: "b3" in entered_so_far(), "The late B did not run after C")
    releases["b3"].set()

    for name, thread in threads.items():
        thread.join(timeout=5)
        assert not thread.is_alive(), f"{name} never finished"

    assert entered[0] == "a"
    assert set(entered[1:3]) == {"b1", "b2"}
    assert entered[3:] == ["c", "b3"]
    assert gate.active_evaluations == 0
    assert gate.waiting_evaluations == 0


def test_the_env_key_separates_requests_by_every_variable():
    assert server.request_env_key(None) == ()
    assert server.request_env_key({}) == ()
    same = {"OPENAI_API_KEY": "k", "AZURE_API_KEY": "a"}
    assert server.request_env_key(same) == server.request_env_key(
        dict(reversed(same.items()))
    )
    assert server.request_env_key({"OPENAI_API_KEY": "k"}) != server.request_env_key(
        {"OPENAI_API_KEY": "other"}
    )
    # A credential no provider list here covers still changes the key. Bedrock
    # reaches litellm through AWS variables, and the evaluators that copy the
    # whole env would otherwise overwrite each other while both run.
    assert server.request_env_key({"AWS_SECRET_ACCESS_KEY": "a"}) != ()
    assert server.request_env_key(
        {"AWS_SECRET_ACCESS_KEY": "a"}
    ) != server.request_env_key({"AWS_SECRET_ACCESS_KEY": "b"})
