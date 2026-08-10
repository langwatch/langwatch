"""
Unit tests for the session-scoped tag registry used by the e2e tag fixtures.

Marked `unit` and kept out of `tests/e2e/`, so `make test-unit` runs them with
no API key and no backend. The accounting they cover is what turns a silent
teardown failure into a visible one, and a guard that only ran when the e2e
secrets are present would be absent from exactly the runs that need it most.

The e2e suite itself proves the fixtures talk to the real backend. These prove
the ledger underneath them counts correctly, including the paths a real run
cannot be made to take on demand (a delete that fails, a teardown that never
runs at all).
"""

from typing import List, Tuple

import pytest

from fixtures.tag_registry import SessionTagRegistry


def _recording_deleter(fails: List[str]):
    """A deleter that reports failure for the named tags and success otherwise."""
    calls: List[Tuple[str, str]] = []

    def delete(name: str, context: str) -> bool:
        calls.append((name, context))
        return name not in fails

    return delete, calls


@pytest.mark.unit
class TestSessionTagRegistry:
    def test_reports_nothing_created_for_an_untouched_session(self):
        registry = SessionTagRegistry()

        assert (registry.created, registry.cleaned, registry.leaked) == (0, 0, 0)
        assert registry.pending == []

    def test_counts_a_tag_cleaned_by_its_own_test_teardown(self):
        registry = SessionTagRegistry()

        registry.track("e2e-tag-a")
        registry.mark_cleaned("e2e-tag-a")

        assert (registry.created, registry.cleaned, registry.leaked) == (1, 1, 0)
        assert registry.pending == []

    def test_sweeps_a_tag_whose_test_teardown_never_ran(self):
        registry = SessionTagRegistry()
        delete, calls = _recording_deleter(fails=[])

        for name in ("e2e-tag-a", "e2e-tag-b", "e2e-tag-c"):
            registry.track(name)
        # Only the first one got a per-test teardown; the other two are the
        # SIGKILL-between-create-and-delete shape this registry exists for.
        registry.mark_cleaned("e2e-tag-a")

        registry.sweep(delete, "_session_tag_registry")

        # Both survivors, not just the first. The sweep mutates the pending
        # list as it goes, so iterating it live would skip the element after
        # every successful delete and leave half the tags in the org while
        # still reporting a clean run.
        assert calls == [
            ("e2e-tag-b", "_session_tag_registry"),
            ("e2e-tag-c", "_session_tag_registry"),
        ]
        assert (registry.created, registry.cleaned, registry.leaked) == (3, 3, 0)
        assert registry.pending == []

    def test_counts_a_tag_the_sweep_could_not_delete_as_leaked(self):
        registry = SessionTagRegistry()
        delete, _ = _recording_deleter(fails=["e2e-tag-b"])

        registry.track("e2e-tag-a")
        registry.track("e2e-tag-b")

        registry.sweep(delete, "_session_tag_registry")

        # The whole point: the sweep raised nothing and still left a tag in the
        # org. Without this count the run is indistinguishable from a clean one.
        assert (registry.created, registry.cleaned, registry.leaked) == (2, 1, 1)
        assert registry.pending == ["e2e-tag-b"]

    def test_keeps_leaked_and_pending_agreeing_after_a_sweep(self):
        registry = SessionTagRegistry()
        delete, _ = _recording_deleter(fails=["e2e-tag-b", "e2e-tag-c"])

        for name in ("e2e-tag-a", "e2e-tag-b", "e2e-tag-c"):
            registry.track(name)

        registry.sweep(delete, "_session_tag_registry")

        # Two ways of saying "what is still out there" that are computed
        # independently. A drift between them means the ledger is wrong, and a
        # wrong ledger reports a leak as clean.
        assert registry.leaked == len(registry.pending)

    def test_sweeping_twice_does_not_double_count_a_recovered_tag(self):
        registry = SessionTagRegistry()
        registry.track("e2e-tag-a")

        failing, _ = _recording_deleter(fails=["e2e-tag-a"])
        registry.sweep(failing, "_session_tag_registry")
        assert registry.leaked == 1

        succeeding, _ = _recording_deleter(fails=[])
        registry.sweep(succeeding, "_session_tag_registry")

        assert (registry.created, registry.cleaned, registry.leaked) == (1, 1, 0)
        assert registry.pending == []
