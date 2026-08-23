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

import asyncio
import os
import sys
import threading
import time
from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError

# Same import guard as the other server tests (see test_server_concurrency):
# `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD at import
# time, and both are restored right after. The evaluator selection must match
# the other files exactly, because only the first of them that pytest collects
# actually imports the module and the rest inherit whatever it loaded.
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
    # Bound before the patch. Reading the attribute inside the double would
    # read the double itself, and the released thread would recurse into it
    # until it ran out of stack instead of scoring the entry.
    real_evaluate = ExactMatchEvaluator.evaluate

    def hanging_evaluate(self, entry):
        entered.release()
        release.wait()
        return real_evaluate(self, entry)

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

    One slot, one stuck request, and a second request already queued behind
    it. Without a deadline the second waits out the queue timeout and 503s,
    and every request after it does too. With one, the stuck batch gives up
    and the caller in the queue is admitted.
    """
    monkeypatch.setattr(server, "EVALUATION_TIMEOUT_SECONDS", 0.5)
    gate = server.EvaluationGate(max_concurrent=1, timeout_seconds=5)
    monkeypatch.setattr(server, "evaluation_gate", gate)

    transport = httpx.ASGITransport(app=server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        stuck = asyncio.ensure_future(
            client.post(EXACT_MATCH_URL, json=evaluation_request())
        )
        # Queue the follow-up only once the stuck evaluation really holds the
        # only slot. Sending it first would let it take the slot itself and
        # the 200 below would prove nothing about the queue.
        await asyncio.to_thread(hanging_exact_match.acquire)
        assert gate.active_evaluations == 1

        follow_up = await client.post(EXACT_MATCH_URL, json=evaluation_request())
        stuck_response = await stuck

    # 503 here is the wedge: the queue timeout ran out while the stuck request
    # still held the slot.
    assert follow_up.status_code == 200
    assert stuck_response.status_code == 200
    assert gate.active_evaluations == 0


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


# @scenario "An evaluator that batches its own way still stops at the deadline"
def test_an_evaluator_that_batches_its_own_way_stops_at_the_deadline(monkeypatch):
    """Accepting `max_seconds` is not the same as honoring it.

    The moderation evaluator sends the whole batch in two calls of its own
    rather than one per entry, so the base class deadline never runs for it.
    A call that stalls holds the gate slot for as long as the socket stays
    open unless this override bounds it itself.
    """
    from langevals_openai.moderation import (
        OpenAIModerationEntry,
        OpenAIModerationEvaluator,
    )

    # What an unbounded call against a dead provider costs. Far enough above
    # the deadline below that `elapsed` can tell the two apart.
    UNBOUNDED_STALL_SECONDS = 5.0
    bounds: list[float | None] = []

    class StallingModerations:
        """Answers no sooner than the bound it was given, then gives up.

        A real socket read returns nothing until the timeout expires, so the
        wait has to be here for the elapsed assertion to measure anything. A
        call made with no bound at all stalls for the full five seconds, which
        is what makes that assertion fail if the deadline stops being passed.
        """

        def __init__(self, bound: float | None):
            self._bound = bound

        def create(self, input):
            time.sleep(self._bound if self._bound is not None else UNBOUNDED_STALL_SECONDS)
            raise APITimeoutError(request=httpx.Request("POST", "http://test"))

    class StallingClient:
        moderations = StallingModerations(bound=None)

        def with_options(self, timeout):
            bounds.append(timeout)
            return SimpleNamespace(moderations=StallingModerations(bound=timeout))

    monkeypatch.setattr(
        "langevals_openai.moderation.OpenAI", lambda **kwargs: StallingClient()
    )

    evaluator = OpenAIModerationEvaluator(env={"OPENAI_API_KEY": "sk-test"})
    started = time.monotonic()
    results = evaluator.evaluate_batch(
        [
            OpenAIModerationEntry(input="hello", output="hi"),
            OpenAIModerationEntry(input="bye", output="see you"),
        ],
        max_seconds=0.5,
    )
    elapsed = time.monotonic() - started

    # One answer per entry, every one of them the timeout error.
    assert len(results) == 2
    assert [result.error_type for result in results] == [
        "EvaluationTimeout",
        "EvaluationTimeout",
    ]
    # The bound really was handed to the call rather than only computed.
    assert bounds and all(0 < bound <= 0.5 for bound in bounds)
    # And the stalling call was cut off at the bound rather than waited out.
    assert elapsed < UNBOUNDED_STALL_SECONDS / 2


# @scenario "A slot comes back before the caller queued behind it gives up"
def test_the_deadline_is_shorter_than_the_queue_a_caller_waits_in():
    """A slot has to come back before the queue behind it times out.

    If a batch could hold its slot for longer than a waiter is willing to
    queue, the waiters ahead of the freed capacity would 503 anyway and the
    deadline would buy nothing.
    """
    assert server.EVALUATION_TIMEOUT_SECONDS <= server.EVALUATION_QUEUE_TIMEOUT_SECONDS


# @scenario "A stalled model call is answered as a provider timeout"
def test_a_stalled_model_call_is_answered_as_a_provider_timeout(monkeypatch):
    """A provider timeout names the provider; an abandoned batch names nothing.

    Both bounds return the slot, so this is about which error the caller
    reads. Only the model call losing the race makes the answer useful.

    Driven through the batch rather than the endpoint, with one attempt: the
    waits between retries are real seconds, and how many attempts fit is what
    the next test measures instead.
    """
    import litellm
    from langevals_langevals.exact_match import (
        ExactMatchEntry,
        ExactMatchEvaluator,
    )

    def stalled_call(self, entry):
        raise litellm.Timeout(
            message=(
                f"Connection timed out after {server.MODEL_TIMEOUT_SECONDS} seconds."
            ),
            model="gpt-5-mini",
            llm_provider="openai",
        )

    monkeypatch.setattr(ExactMatchEvaluator, "evaluate", stalled_call)

    [result] = ExactMatchEvaluator().evaluate_batch(
        [ExactMatchEntry(output="42", expected_output="42")],
        retries=1,
        # Well above anything this test spends, so the batch deadline cannot
        # be what produces the answer below.
        max_seconds=30,
    )

    assert result.status == "error"
    # Named after the model call, not after the batch giving up. The two are
    # different answers and this is the one that says where to look.
    assert result.error_type == "Timeout"
    assert result.error_type != "EvaluationTimeout"
    assert "litellm.Timeout" in result.details


# @scenario "A stalled model call runs out of attempts before the batch gives up"
@pytest.mark.parametrize(
    "deadline", [0.1, 0.5, 0.99, 1, 1.5, 5, 10, 21, 30, 60, 120, 300, 600, 5000]
)
@pytest.mark.parametrize("override", [None, 0.25, 1.0, 5.0, 90.0, 180.0, 600.0])
def test_every_model_call_attempt_fits_inside_the_batch_deadline(deadline, override):
    """One call under the deadline is not enough: the retries have to fit too.

    An entry dials a stalled provider once per attempt with waits in between.
    If that whole budget runs past the batch deadline, the batch is what gives
    up and the caller reads an abandoned evaluation after all.

    Swept over the deadline and the `LANGEVALS_MODEL_TIMEOUT` override rather
    than read off the live module, so the invariant is the function's and not
    an accident of the default configuration. Both knobs take fractions, so
    the sweep carries deadlines under a second: those have no whole second to
    round the model timeout to, and rounding up to one overran the deadline.
    """
    attempts, timeout = server.resolve_model_call_bounds(
        batch_deadline=float(deadline), model_timeout=override
    )

    assert attempts >= 1
    assert timeout > 0
    assert (
        server.model_call_budget_seconds(attempts=attempts, model_timeout=timeout)
        <= deadline
    )


def test_the_resolved_model_timeout_is_the_one_litellm_applies():
    """A bound that is computed and not applied stops nothing."""
    import litellm

    assert litellm.request_timeout == server.MODEL_TIMEOUT_SECONDS
    assert (
        server.model_call_budget_seconds(
            attempts=server.MODEL_CALL_ATTEMPTS,
            model_timeout=server.MODEL_TIMEOUT_SECONDS,
        )
        <= server.EVALUATION_TIMEOUT_SECONDS
    )
