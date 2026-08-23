"""Regression tests for the gate slot a stuck evaluation used to hold forever.

The gate bounds how many evaluations run at once. A ticket is taken when a
request is admitted and given back when its batch returns, so an evaluation
that never returns keeps its ticket for the life of the process. Enough of
them and every later request waits out the queue timeout and gets
"Evaluation queue is full", including requests that would have finished in a
second. Nothing reclaims the slots, so the process stays wedged until it is
restarted.

An evaluation waits on a model call over the network. That call can hang, so
the fix is a deadline: a batch stops waiting, reports the entries that did not
finish as errors, and gives its ticket back. The stuck work is abandoned, not
waited on.

These tests drive the real ASGI app in-process and never touch a provider:
the evaluator's `evaluate` blocks on an Event the test controls, which is what
a hung socket looks like from here.
"""

import os
import sys
import threading

import httpx
import pytest

# Same import guard as the other server tests (see test_server_concurrency):
# `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD at import
# time, and both are restored right after.
_original_argv = sys.argv
_original_preload = os.environ.get("DISABLE_EVALUATORS_PRELOAD")
sys.argv = ["server.py", "--only", "langevals"]
os.environ["DISABLE_EVALUATORS_PRELOAD"] = "1"
try:
    from langevals import server
finally:
    sys.argv = _original_argv
    if _original_preload is None:
        os.environ.pop("DISABLE_EVALUATORS_PRELOAD", None)
    else:
        os.environ["DISABLE_EVALUATORS_PRELOAD"] = _original_preload

server.original_env = os.environ.copy()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def hanging_exact_match(monkeypatch):
    """An evaluator whose call never returns until the test lets it.

    Released in teardown so the abandoned worker threads do not outlive the
    test, which is the one thing the server itself cannot do: it has no way to
    interrupt a thread parked in a socket read.
    """
    from langevals_langevals.exact_match import ExactMatchEvaluator

    release = threading.Event()
    entered = threading.Semaphore(0)

    def hanging_evaluate(self, entry):
        entered.release()
        release.wait()
        return ExactMatchEvaluator.evaluate(self, entry)

    monkeypatch.setattr(ExactMatchEvaluator, "evaluate", hanging_evaluate)
    try:
        yield entered
    finally:
        release.set()


def evaluation_request() -> dict:
    return {"data": [{"output": "42", "expected_output": "42"}], "settings": {}}


EXACT_MATCH_URL = "http://test/langevals/exact_match/evaluate"


# @scenario "A stuck evaluation gives its gate slot back"
@pytest.mark.anyio
async def test_a_stuck_evaluation_gives_its_gate_slot_back(
    hanging_exact_match, monkeypatch
):
    """The whole point: a hung evaluation must not wedge the process.

    One slot, one stuck request. Without a deadline the second request waits
    out the queue timeout and 503s, and every request after it does too. With
    one, the stuck batch gives up, and the queue moves again.
    """
    monkeypatch.setattr(server, "EVALUATION_TIMEOUT_SECONDS", 0.5)
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=5)
    monkeypatch.setattr(server, "evaluation_gate", gate)

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        stuck = await client.post(EXACT_MATCH_URL, json=evaluation_request())
        assert stuck.status_code == 200

        # The slot is free again, so a later request runs rather than queueing
        # behind work that will never finish.
        assert gate.active_evaluations == 0
        follow_up = await client.post(EXACT_MATCH_URL, json=evaluation_request())
        assert follow_up.status_code == 200


# @scenario "An entry that ran out of time is reported as an error"
@pytest.mark.anyio
async def test_an_entry_that_ran_out_of_time_is_reported_as_an_error(
    hanging_exact_match, monkeypatch
):
    """The caller is told what happened, per entry, instead of being hung."""
    monkeypatch.setattr(server, "EVALUATION_TIMEOUT_SECONDS", 0.5)

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(EXACT_MATCH_URL, json=evaluation_request())

    assert response.status_code == 200
    [result] = response.json()
    assert result["status"] == "error"
    assert result["error_type"] == "EvaluationTimeout"


# @scenario "A batch that finishes in time is untouched"
@pytest.mark.anyio
async def test_a_batch_that_finishes_in_time_is_untouched(monkeypatch):
    """The deadline only ever fires on work that overran it."""
    monkeypatch.setattr(server, "EVALUATION_TIMEOUT_SECONDS", 30)

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(EXACT_MATCH_URL, json=evaluation_request())

    assert response.status_code == 200
    [result] = response.json()
    assert result["status"] == "processed"


# @scenario "Every evaluator accepts the arguments the server calls it with"
def test_every_evaluator_accepts_the_arguments_the_server_calls_it_with():
    """One endpoint calls every evaluator, so one signature has to fit them all.

    An evaluator that batches differently may override `evaluate_batch`. A
    narrower override still imports and still loads, and only fails when a
    customer calls that one evaluator, as a 500 with a TypeError. Bind the
    server's own call against each signature instead of waiting for that.
    """
    import inspect

    from langevals_core.base_evaluator import BaseEvaluator

    checked = 0
    for evaluator_package in server.load_evaluator_packages().values():
        for evaluator_cls in server.get_evaluator_classes(evaluator_package):
            signature = inspect.signature(evaluator_cls.evaluate_batch)
            signature.bind(
                evaluator_cls,
                [],
                max_evaluations_in_parallel=server.MAX_EVALUATIONS_IN_PARALLEL,
                max_seconds=server.EVALUATION_TIMEOUT_SECONDS,
            )
            checked += 1

    assert checked > 0, "no evaluators loaded, so this proved nothing"
    # The base class is what the overrides have to stay compatible with.
    inspect.signature(BaseEvaluator.evaluate_batch).bind(
        None, [], max_evaluations_in_parallel=1, max_seconds=1.0
    )

    # And the bind really does reject a narrow override, so a green run above
    # means the signatures fit rather than that nothing was checked. This is
    # the shape the moderation evaluator carried, which the server could not
    # call at all.
    def narrow_override(self, data, index=0):
        raise NotImplementedError

    with pytest.raises(TypeError):
        inspect.signature(narrow_override).bind(
            None, [], max_evaluations_in_parallel=1, max_seconds=1.0
        )


# @scenario "The evaluation deadline is shorter than the queue a caller waits in"
def test_the_deadline_is_shorter_than_the_queue_a_caller_waits_in():
    """A slot has to come back before the queue behind it times out.

    If a batch could hold its slot for longer than a waiter is willing to
    queue, the waiters ahead of the freed capacity would 503 anyway and the
    deadline would buy nothing.
    """
    assert server.EVALUATION_TIMEOUT_SECONDS <= server.EVALUATION_QUEUE_TIMEOUT_SECONDS
