import os

import pytest
import yaml

from judge_router import load
from judge_router.config import ARITHMETIC, DEFAULT_PATH, JOBS, metrics_path_for

API_BACKENDS = {"decisions", "jev", "haiku", "luna"}


def _write(tmp_path, name, data):
    p = tmp_path / name
    p.write_text(yaml.safe_dump(data))
    return str(p)


def _routes():
    return yaml.safe_load(open(DEFAULT_PATH))


# ---------- routing table alone ----------

def test_defaults_balanced(table):
    assert table.default_mode == {j: "balanced" for j in JOBS}
    assert not table.has_metrics


def test_every_slot_exists(table):
    for job in JOBS:
        for key in ["<=2k", "2k-8k", "8k-32k", ">32k", ARITHMETIC]:
            assert table.slot(job, key).modes["instant"].enabled


def test_enabled_entries_are_api_only(table):
    for s in table.slots.values():
        for e in s.modes.values():
            assert e.enabled and e.metrics is None
            assert all(table.backends[b].enabled and not table.backends[b].gpu for b in e.backends)
            assert set(e.backends) <= API_BACKENDS


def test_gpu_backends_are_wired_with_fallbacks(table):
    for name in ("vega", "nox"):
        b = table.backends[name]
        assert b.gpu and not b.enabled and b.fallbacks == ("decisions",)


def test_validation_rejects_a_missing_slot(tmp_path):
    raw = _routes()
    del raw["routes"]["search"][">32k"]
    with pytest.raises(ValueError):
        load(_write(tmp_path, "r.yaml", raw))


def test_validation_rejects_an_unknown_fallback(tmp_path):
    raw = _routes()
    raw["backends"]["vega"]["fallbacks"] = ["nowhere"]
    with pytest.raises(ValueError):
        load(_write(tmp_path, "r.yaml", raw))


# ---------- overlay mechanics, on a small fixture overlay ----------

def test_overlay_is_found_beside_the_table(tmp_path):
    path = _write(tmp_path, "routes.yaml", _routes())
    assert metrics_path_for(path) == str(tmp_path / "routes.metrics.yaml")
    assert not load(path).has_metrics
    _write(tmp_path, "routes.metrics.yaml", {"routes": {"search": {"<=2k": {
        "balanced": {"metrics": {"score": 50.0, "usd_per_1k": 1.0, "p50_ms": 100, "n": 10}, "note": "fixture"}}}}})
    t = load(path)
    e = t.slot("search", "<=2k").modes["balanced"]
    assert t.has_metrics and e.enabled and e.metrics.n == 10 and e.note == "fixture"
    assert (e.primary, e.escalate_to) == ("decisions", "haiku")
    assert load(path, use_metrics=False).slot("search", "<=2k").modes["balanced"].metrics is None


def test_cap_applies_only_with_metrics(tmp_path):
    path = _write(tmp_path, "routes.yaml", _routes())
    over = _write(tmp_path, "m.yaml", {"routes": {"llm_judge": {">32k": {
        "accurate": {"primary": "luna", "metrics": {"score": 1.0, "usd_per_1k": 9.0, "p50_ms": 1, "n": 1}}}}}})
    e = load(path, metrics_path=over).slot("llm_judge", ">32k").modes["accurate"]
    assert not e.enabled and "not under" in e.disabled_why
    assert "accurate" not in load(path).slot("llm_judge", ">32k").modes


def test_overlay_alternatives_and_backends(tmp_path):
    path = _write(tmp_path, "routes.yaml", _routes())
    over = _write(tmp_path, "m.yaml", {
        "backends": {"extra": {"kind": "none", "enabled": False}},
        "routes": {"search": {"<=2k": {
            "measured_on": {"splits": ["s"], "min_tokens": 0, "max_tokens": 2000},
            "alternatives": [{"mode": "accurate", "primary": "extra", "why": "not wired"},
                             {"mode": "instant", "primary": "decisions", "pair_with": "vega", "why": "GPU"}]}}}})
    s = load(path, metrics_path=over).slot("search", "<=2k")
    assert s.measured_on.splits == ("s",) and len(s.alternatives) == 2
    assert not any(a.enabled for a in s.alternatives) and s.alternatives[0].disabled_why == "not wired"


@pytest.mark.parametrize("overlay", [
    {"routes": {"search": {"<=2k": {"balanced": {"escalate_to": "luna"}}}}},
    {"routes": {"search": {"9k": {"instant": {"metrics": None}}}}},
])
def test_overlay_cannot_change_routing(tmp_path, overlay):
    path = _write(tmp_path, "routes.yaml", _routes())
    with pytest.raises(ValueError):
        load(path, metrics_path=_write(tmp_path, "m.yaml", overlay))


def test_explicit_missing_overlay_is_an_error():
    with pytest.raises(FileNotFoundError):
        load(metrics_path="/nonexistent/routes.metrics.yaml")


# ---------- the private overlay (skipped when absent) ----------

def test_overlay_keeps_every_route(table, metrics_table):
    for k, s in table.slots.items():
        full = {m: e for m, e in metrics_table.slots[k].modes.items() if e.enabled}
        assert {m: e.backends + (e.threshold,) for m, e in s.modes.items()} == {m: e.backends + (e.threshold,) for m, e in full.items()}, k


def test_enabled_entries_are_under_the_cap(metrics_table):
    for s in metrics_table.slots.values():
        for e in s.modes.values():
            if e.enabled and e.metrics:
                assert e.metrics.usd_per_1k < metrics_table.max_usd_per_1k


def test_alternatives_are_present_but_off(metrics_table):
    alts = [a for s in metrics_table.slots.values() for a in s.alternatives]
    assert alts and not any(a.enabled for a in alts)
    assert any(a.metrics and a.metrics.usd_per_1k >= 5 for a in alts)  # the pricier options are kept for comparison
    assert any("vega" in a.backends for a in alts)


def test_over_cap_entry_is_disabled(metrics_table):
    e = metrics_table.slot("llm_judge", ">32k").modes["accurate"]
    assert not e.enabled and "not under" in e.disabled_why


def test_vega_replacements_are_recorded(metrics_table):
    for job, key in [("search", "8k-32k"), ("scenario_judge", "8k-32k"), ("scenario_judge", ">32k")]:
        assert any(e.replaces for e in metrics_table.slot(job, key).modes.values()), (job, key)


def test_no_em_dashes_in_package():
    dash = chr(0x2014)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ("__pycache__", ".pytest_cache", ".venv")]
        for f in files:
            if f.endswith((".py", ".yaml", ".md", ".toml")):
                assert dash not in open(os.path.join(d, f), encoding="utf-8").read(), f
