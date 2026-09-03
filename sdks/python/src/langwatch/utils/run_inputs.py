"""The parts of a run request that belong to no one facade.

The run plan and test suite facades both send the fields that belong to one
run rather than to the plan. They live here so neither facade module imports
the other: importing a sibling binds it on the ``langwatch`` package, which
shadows the lazy facade of the same name.
"""

from typing import Any, Dict, Optional, Sequence

SCOPE_MODES = ("all", "test_suites", "labels", "scenarios")
"""The scope modes the platform has. Mirrors `suiteScopeSchema` in
packages/features/suite/contract/src/suite.scope.ts."""


def build_scope(
    mode: str,
    *,
    test_suite_ids: Optional[Sequence[str]] = None,
    labels: Optional[Sequence[str]] = None,
    scenario_ids: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Resolve the scope object the run body carries.

    Every mode but ``all`` reads a list, and a mode whose list is missing is a
    mistake the caller can fix without a round trip, so it raises here rather
    than travelling to the platform to be refused. ``scenarios`` is the
    exception in shape only: its list is sent as the configuration's
    ``scenarioIds``, so the scope object itself carries the mode alone.
    """
    if mode == "all":
        return {"mode": "all"}
    if mode == "test_suites":
        if not test_suite_ids:
            raise ValueError(
                'scope="test_suites" needs test_suite_ids: name the test suites to run'
            )
        return {"mode": "test_suites", "testSuiteIds": list(test_suite_ids)}
    if mode == "labels":
        if not labels:
            raise ValueError(
                'scope="labels" needs labels: name the labels the scenarios carry'
            )
        return {"mode": "labels", "labels": list(labels)}
    if mode == "scenarios":
        if not scenario_ids:
            raise ValueError(
                'scope="scenarios" needs scenario_ids: name the scenarios to run'
            )
        return {"mode": "scenarios"}
    raise ValueError(f"unknown scope {mode!r}: one of {', '.join(SCOPE_MODES)}")


def build_run_inputs(
    *,
    parameters: Optional[Dict[str, Any]],
    note: Optional[str],
    idempotency_key: Optional[str],
) -> Dict[str, Any]:
    """The fields that belong to one run rather than to the plan.

    Only the ones the caller gave: an absent field and a field sent as null
    are different requests, and the caller asked for neither.
    """
    body: Dict[str, Any] = {}
    if idempotency_key is not None:
        body["idempotencyKey"] = idempotency_key
    if parameters is not None:
        body["parameters"] = parameters
    if note is not None:
        body["note"] = note
    return body
