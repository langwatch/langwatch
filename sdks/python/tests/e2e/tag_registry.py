"""
Session-scoped ledger of the prompt tags an e2e run put into the target org.

Lives outside ``conftest.py`` so it can be imported and tested directly. It
holds no backend calls of its own (the deleter is passed in), which is what
lets the failure paths be exercised without an API key.
"""

from typing import Callable, List


class SessionTagRegistry:
    """
    Records every tag this session created, and what became of it.

    ``tag_factory`` tracks each tag here as well as on its own per-test list,
    and marks it cleaned when per-test teardown removes it. Whatever is still
    pending at session end is swept; whatever survives the sweep is a leak.

    The counting is the point rather than an extra. Teardown must not raise, so
    the tag deleter swallows every failure, which leaves a teardown that
    quietly gave up indistinguishable from one that worked. That silence is how
    165 ``e2e-cascade-tag-*`` and 2 ``e2e-tag-b-*`` tags accumulated in a real
    org over three weeks with CI green throughout (#4126).
    """

    def __init__(self) -> None:
        self.created = 0
        self.cleaned = 0
        self.pending: List[str] = []

    def track(self, name: str) -> None:
        """Record a tag that now exists in the target org."""
        self.created += 1
        self.pending.append(name)

    def mark_cleaned(self, name: str) -> None:
        """Record that ``name`` is confirmed gone, so the sweep can skip it."""
        self.cleaned += 1
        if name in self.pending:
            self.pending.remove(name)

    def sweep(self, delete: Callable[[str, str], bool], context: str) -> None:
        """
        Delete everything still pending, keeping the failures pending.

        A name left in ``pending`` after this ran is a tag this session created
        and could not remove, which is exactly what ``leaked`` reports.
        """
        for name in list(self.pending):
            if delete(name, context):
                self.mark_cleaned(name)

    @property
    def leaked(self) -> int:
        return self.created - self.cleaned
