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

    assert os.environ.get("OPENAI_API_KEY") != "must-not-outlive-the-burst"
    assert "PATH" in os.environ


def test_gate_times_out_with_a_clear_error():
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=0.05)
    with gate.admit(()):
        with pytest.raises(server.EvaluationQueueTimeout):
            with gate.admit((("OPENAI_API_KEY", "other"),)):
                pass


def test_model_env_key_ignores_non_model_vars():
    assert server.model_env_key(None) == ()
    assert server.model_env_key({"NOT_A_MODEL_VAR": "x"}) == ()
    same = {"OPENAI_API_KEY": "k", "AZURE_API_KEY": "a"}
    assert server.model_env_key(same) == server.model_env_key(dict(reversed(same.items())))
    assert server.model_env_key({"OPENAI_API_KEY": "k"}) != server.model_env_key(
        {"OPENAI_API_KEY": "other"}
    )
