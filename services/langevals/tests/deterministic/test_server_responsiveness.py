"""Regression tests for the server staying responsive during evaluations.

The evaluate endpoint used to be an async handler running the fully blocking
`evaluate_batch` on the event loop, so one long evaluation froze every other
endpoint, including /healthcheck. On Kubernetes that starves the readiness
probe (5s timeout) after one slow request and the liveness probe under a
burst, which kills the pod mid-evaluation and surfaces to the customer as
"Evaluator cannot be reached".

These tests drive the real ASGI app in-process (no server, no API keys). The
slow evaluation is ragas/context_f1 over large strings: CPU-bound, provider
free, deterministic.

Async tests are marked with anyio, whose pytest plugin ships with the anyio
langevals-core already depends on and defaults to the asyncio backend.
"""

import asyncio
import os
import random
import string
import sys
import time

import httpx
import pytest

# `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD while it is
# imported, to decide which evaluators to register and whether to preload their
# models, so both have to be set before the import. They are put back straight
# afterwards: pytest imports every test module during collection, so leaving
# them changed would hand fake command-line arguments and a disabled preload to
# every other test in the session.
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


def big_text(kb: int, seed: int) -> str:
    rng = random.Random(seed)
    return "".join(rng.choices(string.ascii_lowercase + " ", k=kb * 1024))


SLOW_EVALUATION = {
    "data": [
        {
            "contexts": [big_text(60, seed) for seed in range(3)],
            "expected_contexts": [big_text(60, seed + 1000) for seed in range(3)],
        }
    ],
    "settings": {"distance_measure": "levenshtein"},
}


@pytest.mark.anyio
async def test_healthcheck_answers_while_an_evaluation_runs():
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        start = time.monotonic()
        evaluation = asyncio.create_task(
            client.post("/ragas/context_f1/evaluate", json=SLOW_EVALUATION)
        )
        await asyncio.sleep(0.2)
        health = await client.get("/healthcheck")
        health_at = time.monotonic() - start

        response = await evaluation
        evaluation_took = time.monotonic() - start

    assert health.status_code == 200
    assert response.status_code == 200
    # The evaluation is deliberately slow; the healthcheck must not wait for
    # it. Before the fix the event loop was held for the whole evaluation and
    # health_at equalled evaluation_took.
    assert evaluation_took > 1.0
    assert health_at < 1.0


@pytest.mark.anyio
async def test_request_env_does_not_leak_into_the_process():
    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=120
    ) as client:
        response = await client.post(
            "/langevals/exact_match/evaluate",
            json={
                "data": [{"output": "42", "expected_output": "42"}],
                "settings": {},
                "env": {"OPENAI_API_KEY": "test-must-not-leak"},
            },
        )

    assert response.status_code == 200
    assert response.json()[0]["status"] == "processed"
    assert os.environ.get("OPENAI_API_KEY") != "test-must-not-leak"
    # The environment is restored, not left empty, after the evaluation.
    assert "PATH" in os.environ
