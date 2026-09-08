"""Regression test for the dspy thread-affinity crash on a long-lived server.

The langevals server dispatches every request to a worker thread. dspy 3 records
the identifier of the first thread that calls `dspy.settings.configure` and
raises

    dspy.settings can only be changed by the thread that initially configured it.

for every later `configure` from any other thread. An evaluator that configured
global settings therefore served the first request and then failed every request
that landed on a different worker thread. A tier that gives each request a fresh
process never saw this. A long-lived self-hosted server saw it from the second
evaluation onwards.

The workers must overlap for this test to mean anything. dspy compares
`threading.get_ident()` values, and CPython reuses an identifier as soon as the
thread holding it exits, so starting one worker and joining it before starting
the next hands the second worker the first one's identifier and dspy's check
passes by accident. A barrier holds every worker until they are all running,
which is both the real shape of the server under load and the only shape that
reproduces the crash every time.

The transport to the model provider is stubbed with litellm's `mock_response`,
so this file needs no API key and makes no network call to a provider. That is
what lets it run in CI, unlike the LLM-judged tests next to it. Everything else
is the real path: the real `model_to_dspy_lm`, the real `dspy.Predict`, the real
adapter parsing.
"""

import threading

import pytest

from langevals_langevals import llm_answer_match
from langevals_langevals.llm_answer_match import (
    LLMAnswerMatchEntry,
    LLMAnswerMatchEvaluator,
    LLMAnswerMatchSettings,
)

WORKERS = 4

REASONING = "Both answers name rock music."

MOCK_COMPLETION = (
    "[[ ## reasoning ## ]]\n"
    f"{REASONING}\n"
    "[[ ## is_correct ## ]]\n"
    "True\n"
    "[[ ## completed ## ]]\n"
)

ENTRY = LLMAnswerMatchEntry(
    input="What genre do The Gaslight Anthem and Seaweed share?",
    output="The Gaslight Anthem and Seaweed share the genre of rock music.",
    expected_output="rock",
)


@pytest.fixture
def stubbed_provider(monkeypatch):
    """Keep the real dspy LM, replace only the call out to the provider."""
    build_lm = llm_answer_match.model_to_dspy_lm

    def build_stubbed_lm(model: str):
        lm = build_lm(model)
        lm.kwargs["mock_response"] = MOCK_COMPLETION
        lm.cache = False
        return lm

    monkeypatch.setattr(llm_answer_match, "model_to_dspy_lm", build_stubbed_lm)


def test_evaluates_from_worker_threads_running_at_the_same_time(stubbed_provider):
    ready = threading.Barrier(WORKERS)
    lock = threading.Lock()
    results = []
    errors = []
    thread_ids = []

    def evaluate_on_this_thread():
        # Hold here until every worker is running, so no worker can inherit the
        # identifier of one that already exited.
        ready.wait(timeout=30)
        with lock:
            thread_ids.append(threading.get_ident())
        try:
            evaluator = LLMAnswerMatchEvaluator(
                settings=LLMAnswerMatchSettings(model="openai/gpt-5-mini")
            )
            result = evaluator.evaluate(ENTRY)
            with lock:
                results.append(result)
        except Exception as error:  # noqa: BLE001 - the crash is what we assert on
            with lock:
                errors.append(error)

    threads = [
        threading.Thread(target=evaluate_on_this_thread, name=f"worker-{index}")
        for index in range(WORKERS)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert not any(thread.is_alive() for thread in threads)
    # Every worker really was a distinct thread as far as dspy can tell. Without
    # this the test could pass on recycled identifiers and guard nothing.
    assert len(set(thread_ids)) == WORKERS
    assert [repr(error) for error in errors] == []
    assert [result.status for result in results] == ["processed"] * WORKERS
    # Proves each evaluation went through the model call and parsed the
    # response, rather than short-circuiting before it.
    assert [result.details for result in results] == [REASONING] * WORKERS
    assert all(result.passed for result in results)
