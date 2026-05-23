"""
Regression test for #3981 — offline-experiment cell traces silently lost on OTLP path.

Root cause: `langwatch.trace(disable_sending=True)` flipped `Client._disable_sending`
on the singleton classvar without restoring it.

In `langwatch_nlp` the runtime reuses worker processes across event types:
- `execute_evaluation` and `execute_optimization` explicitly set
  `client.disable_sending = True`.
- `execute_component` (used by offline-experiment cells) does not set it.

Result: a worker that previously handled an evaluation/optimization keeps
`_disable_sending = True`, and every subsequent `execute_component` from an
offline-experiment cell has its spans dropped by `ConditionalSpanExporter`
even though the caller never opted into disabling.

PR #3979 papered over the symptom by synthesizing a stand-in `recordSpan` from
the orchestrator. This test exercises the SDK-level bug directly, so the fix
must scope the flag per-trace lifetime — and remain correct under overlapping
concurrent traces, not just sequential reuse.
"""

import threading

import langwatch
from langwatch.client import Client
from langwatch.state import get_instance


def _make_setup(**overrides):
    """Setup args matching what nlp's execute_event passes."""
    defaults = {
        "api_key": "test-key-3981",
        "endpoint_url": "http://localhost:5560",
        "skip_open_telemetry_setup": True,  # we don't need a real exporter
    }
    defaults.update(overrides)
    return defaults


class TestDisableSendingSingletonPoisoning:
    """
    Reproduces the offline-experiment trace-loss bug from issue #3981.

    The trigger is a worker process that handles an `execute_evaluation`
    or `execute_optimization` first (sets `disable_sending=True`), then
    handles an `execute_component` for an offline-experiment cell.
    """

    def setup_method(self):
        Client.reset_for_testing()

    def teardown_method(self):
        Client.reset_for_testing()

    def test_disable_sending_is_restored_after_trace_block_exits(self):
        """
        A `langwatch.trace(disable_sending=True)` block must not leave the
        singleton flag flipped after it exits.

        This is the minimum guarantee the SDK must provide so worker reuse
        in `langwatch_nlp` cannot poison subsequent unrelated traces.
        """
        langwatch.setup(**_make_setup())

        client = get_instance()
        assert client is not None
        assert client.disable_sending is False, (
            "Precondition: client starts with sending enabled"
        )

        # Simulate an `execute_evaluation` invocation on this worker.
        # nlp's `optional_langwatch_trace` ends up calling `langwatch.trace`
        # with `disable_sending=True` for the duration of an evaluation block.
        with langwatch.trace(name="evaluation-block", disable_sending=True):
            assert client.disable_sending is True, (
                "Sanity: inside the disable_sending block, flag is True"
            )

        # After the block exits, the worker process is returned to the pool.
        # The next event handled by this worker may be an `execute_component`
        # for an offline-experiment cell — its spans MUST be sent.
        assert client.disable_sending is False, (
            "After a `disable_sending=True` trace block exits, the singleton "
            "flag must be restored. Otherwise subsequent unrelated traces on "
            "the same worker silently drop spans (#3981)."
        )

    def test_subsequent_trace_without_disable_sending_actually_sends(self):
        """
        End-to-end shape of the poisoning bug: simulate the worker handling
        an evaluation (disable_sending=True), then immediately handling an
        offline-experiment cell's execute_component (default disable_sending).

        The second trace's spans must reach the exporter.
        """
        langwatch.setup(**_make_setup())

        client = get_instance()
        assert client is not None

        # First "event" — evaluation, sending disabled. Mirrors nlp's
        # `execute_evaluation` and `execute_optimization` cases.
        with langwatch.trace(name="prior-evaluation", disable_sending=True):
            pass

        # Second "event" — offline-experiment cell. nlp's `execute_component`
        # creates a trace with disable_sending=False (the default).
        with langwatch.trace(name="offline-experiment-cell"):
            # During an offline-experiment cell, the exporter check
            # (ConditionalSpanExporter.export) reads this flag at export
            # time. It MUST be False or the span is dropped silently.
            assert client.disable_sending is False, (
                "After a prior `disable_sending=True` trace, a subsequent "
                "default trace must NOT inherit the disabled flag. "
                "ConditionalSpanExporter would otherwise drop every span "
                "for offline-experiment cells (#3981)."
            )

    def test_nested_disable_sending_restores_outer_state(self):
        """
        Defense in depth: even when traces nest, exiting an inner block must
        restore the state the outer block established — not the SDK default.
        """
        langwatch.setup(**_make_setup())

        client = get_instance()
        assert client is not None

        with langwatch.trace(name="outer-default"):
            assert client.disable_sending is False

            with langwatch.trace(name="inner-disabled", disable_sending=True):
                assert client.disable_sending is True

            assert client.disable_sending is False, (
                "Inner `disable_sending=True` block must restore the outer "
                "state (False) on exit. Leaking the True flag to the outer "
                "block silently drops the rest of the outer trace's spans."
            )

        assert client.disable_sending is False

    def test_user_set_disable_sending_baseline_is_preserved(self):
        """
        If the user explicitly set `client.disable_sending = True` outside of
        any trace block, a `disable_sending=True` trace must NOT flip the
        baseline back to False on exit.
        """
        langwatch.setup(**_make_setup())

        client = get_instance()
        assert client is not None
        client.disable_sending = True
        assert client.disable_sending is True

        with langwatch.trace(name="inside-user-disabled", disable_sending=True):
            assert client.disable_sending is True

        assert client.disable_sending is True, (
            "User-set baseline of `disable_sending=True` must survive a "
            "trace block exit — only the refcount-acquired delta should be "
            "released, not the user's intent."
        )

        client.disable_sending = False

    def test_overlapping_concurrent_traces_do_not_corrupt_flag(self):
        """
        CodeRabbit critique: simple snapshot/restore is unsafe under
        overlapping concurrent traces. Two threads start a
        `disable_sending=True` trace each; while both are active the flag
        must stay True; only when the last one exits does it return to the
        baseline. A non-refcounted implementation can leak `True` to the
        baseline or flip back to `False` too early.
        """
        langwatch.setup(**_make_setup())
        client = get_instance()
        assert client is not None

        observations = []
        gate_outer_entered = threading.Event()
        gate_inner_done = threading.Event()
        gate_release_outer = threading.Event()

        def outer():
            with langwatch.trace(name="outer-disabled", disable_sending=True):
                gate_outer_entered.set()
                gate_release_outer.wait(timeout=5)
                observations.append(("outer.exit", client.disable_sending))

        def inner():
            gate_outer_entered.wait(timeout=5)
            with langwatch.trace(name="inner-disabled", disable_sending=True):
                observations.append(("inner.inside", client.disable_sending))
            gate_inner_done.set()

        t_outer = threading.Thread(target=outer)
        t_inner = threading.Thread(target=inner)
        t_outer.start()
        t_inner.start()

        gate_inner_done.wait(timeout=5)
        # Inner has fully exited its `with` block; outer is still holding
        # the disable refcount. Flag must remain True.
        t_inner.join(timeout=5)
        assert client.disable_sending is True, (
            "After inner trace exits but outer still holds the disable "
            "refcount, flag must remain True. Single-slot snapshot/restore "
            "(pre-refcount fix) would have already flipped it to False here."
        )

        gate_release_outer.set()
        t_outer.join(timeout=5)

        assert client.disable_sending is False, (
            "After ALL disable-requesting traces have exited, flag must "
            "return to baseline (False)."
        )
        assert ("inner.inside", True) in observations
        assert ("outer.exit", True) in observations
