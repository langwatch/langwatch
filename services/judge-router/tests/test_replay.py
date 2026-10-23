"""Offline replay over stored per-row outputs (no calls). Skipped without the rows file or the metrics overlay."""
import math
import os

import pytest

from judge_router import load
from judge_router.config import DEFAULT_METRICS_PATH
from judge_router.replay import DEFAULT_ROWS, check_table, load_rows

ROWS = os.environ.get("JUDGE_REPLAY_ROWS", DEFAULT_ROWS)
pytestmark = [
    pytest.mark.skipif(not os.path.exists(ROWS), reason="replay rows not present (set JUDGE_REPLAY_ROWS)"),
    pytest.mark.skipif(not os.path.exists(DEFAULT_METRICS_PATH), reason="metrics overlay routes.metrics.yaml not present"),
]


@pytest.fixture(scope="module")
def rows():
    return load_rows(ROWS)


@pytest.fixture(scope="module")
def table():
    return load()


def test_every_stated_metric_reproduces(rows, table):
    """Scores within 0.1 point. Cost and latency within 10%: where a backend has no stored verdict for a check the router
    counts that call as failed ($0, no latency), while the page averaged the recorded cost of every row."""
    checked = check_table(rows, table)
    assert checked
    for c in checked:
        s, r = c["stated"], c["replay"]
        assert abs(s["score"] - r["score"]) <= 0.1, c
        assert math.isclose(s["usd_per_1k"], r["usd_per_1k"], rel_tol=0.10, abs_tol=0.01), c
        assert math.isclose(s["p50_ms"], r["p50_ms"], rel_tol=0.05, abs_tol=1), c
        assert s["n"] == r["n"], c
