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
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=0.05)
    release = threading.Event()

    def holder():
        with gate.admit(()):
            release.wait(2)

    holding = threading.Thread(target=holder)
    holding.start()
    deadline = time.monotonic() + 2
    while gate.active_evaluations == 0:
        if time.monotonic() >= deadline:
            pytest.fail("The holder was not admitted within 2s")
        time.sleep(0.005)

    # Free the capacity only after every waiter's 0.05s deadline has passed:
    # none of them may be admitted late, and none may linger in the queue.
    threading.Timer(0.3, release.set).start()
    for _ in range(3):
        with pytest.raises(server.EvaluationQueueTimeout):
            with gate.admit((("OPENAI_API_KEY", "late"),)):
                pass
    holding.join(timeout=2)
    assert not holding.is_alive()
    assert gate.waiting_environments == []
    # The gate is healthy afterwards: a fresh request admits immediately.
    with gate.admit((("OPENAI_API_KEY", "fresh"),)):
        assert gate.active_evaluations == 1


def test_model_env_key_ignores_non_model_vars():
    assert server.model_env_key(None) == ()
    assert server.model_env_key({"NOT_A_MODEL_VAR": "x"}) == ()
    same = {"OPENAI_API_KEY": "k", "AZURE_API_KEY": "a"}
    assert server.model_env_key(same) == server.model_env_key(dict(reversed(same.items())))
    assert server.model_env_key({"OPENAI_API_KEY": "k"}) != server.model_env_key(
        {"OPENAI_API_KEY": "other"}
    )
