import pytest

from judge_router import Answer, BackendCapacity, BackendTimeout, BackendUnavailable, Request, load, route, run, unsure
from judge_router.clients import KEY_INVALID, RATE_LIMITED, UNAVAILABLE, BackendError
from judge_router.config import Entry
from judge_router.router import plan_for_entry


class Fake:
    """A client that answers from a script: an Answer, or an exception to raise."""

    def __init__(self, name, out):
        self.name, self.out, self.calls = name, out, 0

    def judge(self, call, timeout_s):
        self.calls += 1
        if isinstance(self.out, Exception):
            raise self.out
        return self.out


def ans(verdict=True, p=None, usd=0.0001, ms=200.0):
    return Answer(verdict=verdict, probability=p, cost_usd=usd, latency_ms=ms)


def req(job="search", tokens=500, question="is the user upset", **kw):
    return Request(job=job, text="x", question=question, tokens=tokens, **kw)


# ---------- route(): pure ----------

def test_unsure_is_the_page_rule():
    # |2p-1| < 0.7  <=>  0.15 < p < 0.85
    assert not unsure(0.15, 0.7) and not unsure(0.85, 0.7)
    assert unsure(0.16, 0.7) and unsure(0.5, 0.7) and unsure(0.84, 0.7)
    assert not unsure(0.0, 0.7) and not unsure(1.0, 0.7)
    assert unsure(None, 0.7)


@pytest.mark.parametrize("tokens,bucket", [(1, "<=2k"), (2000, "<=2k"), (2001, "2k-8k"), (8000, "2k-8k"), (8001, "8k-32k"), (32000, "8k-32k"), (32001, ">32k")])
def test_buckets(table, tokens, bucket):
    assert route(req(tokens=tokens), table).bucket == bucket


def test_default_mode_is_balanced_and_search_short_plan(table):
    p = route(req(tokens=900), table)
    assert (p.mode, p.primary, p.escalate_to, p.threshold) == ("balanced", "decisions", "haiku", 0.7)
    assert p.expected is None
    assert p.order == ("decisions", "haiku")


def test_scenario_short_plan(table):
    p = route(req(job="scenario_judge", tokens=5000, question="the agent apologised"), table)
    assert (p.slot, p.primary, p.escalate_to) == ("2k-8k", "decisions", "luna")


def test_plans_carry_the_expected_metrics(metrics_table):
    p = route(req(tokens=900), metrics_table)
    assert p.expected is not None and p.expected == metrics_table.slot("search", "<=2k").modes["balanced"].metrics
    p = route(req(job="scenario_judge", tokens=5000, question="the agent apologised"), metrics_table)
    assert p.expected == metrics_table.slot("scenario_judge", "2k-8k").modes["balanced"].metrics


def test_instant_is_decision_models_only(table):
    for job in ("search", "llm_judge", "scenario_judge"):
        for tokens in (500, 5000, 20_000, 50_000):
            p = route(req(job=job, tokens=tokens, mode="instant"), table)
            assert set(p.order) <= {"decisions", "jev"}, (job, tokens, p.order)
    p = route(req(tokens=500, mode="instant"), table)
    assert (p.primary, p.pair_with) == ("decisions", "jev")
    p = route(req(job="scenario_judge", tokens=50_000, mode="instant"), table)
    assert p.order == ("jev",)


def test_long_slots(table):
    p = route(req(job="llm_judge", tokens=20_000, question="Is the answer polite?"), table)
    assert (p.primary, p.escalate_to, p.threshold) == ("decisions", "luna", 0.7)
    p = route(req(job="scenario_judge", tokens=20_000), table)
    assert (p.primary, p.escalate_to) == ("jev", "luna")


def test_long_slots_are_measured_on_pooled_sets(metrics_table):
    for job in ("search", "llm_judge", "scenario_judge"):
        slot = metrics_table.slot(job, "8k-32k")
        assert len(slot.measured_on.splits) > 1, job
        assert all(e.metrics.n > 0 for e in slot.modes.values()), job


def test_decisions_jev_pair_takes_the_more_confident(table):
    p = route(req(tokens=5000), table)  # search 2k-8k balanced: Decisions + Jev pair
    assert (p.primary, p.pair_with) == ("decisions", "jev")
    d, j = Fake("decisions", ans(True, 0.55, usd=0.0004, ms=210)), Fake("jev", ans(False, 0.1, usd=0.0002, ms=280))
    r = run(req(tokens=5000), {"decisions": d, "jev": j}, table)
    assert (r.verdict, r.answered_by, r.latency_ms) == (False, "jev", 280)
    assert r.cost_usd == pytest.approx(0.0006) and not r.escalated
    # tie in confidence goes to the primary
    r = run(req(tokens=5000), {"decisions": Fake("decisions", ans(True, 0.9)), "jev": Fake("jev", ans(False, 0.1))}, table)
    assert r.answered_by == "decisions"
    # one leg down: the other answers
    r = run(req(tokens=5000), {"decisions": Fake("decisions", BackendTimeout("t")), "jev": Fake("jev", ans(True, 0.7))}, table)
    assert (r.verdict, r.answered_by) == (True, "jev") and f"decisions_failed:{UNAVAILABLE}" in r.flags
    r = run(req(tokens=5000), {"decisions": Fake("decisions", BackendTimeout("t")), "jev": Fake("jev", BackendCapacity("429"))}, table)
    assert r.verdict is None and r.skip_reason == UNAVAILABLE


def test_jev_first_cascade(table):
    p = route(req(job="scenario_judge", tokens=20_000, mode="accurate"), table)
    assert (p.primary, p.escalate_to, p.threshold) == ("jev", "luna", 0.7)
    j, l = Fake("jev", ans(True, 0.6)), Fake("luna", ans(False))
    r = run(req(job="scenario_judge", tokens=20_000, mode="accurate"), {"jev": j, "luna": l}, table)
    assert (r.verdict, r.answered_by, r.escalated) == (False, "luna", True)


def test_accurate_without_entry_falls_back_to_balanced(table):
    p = route(req(tokens=5000, mode="accurate"), table)
    assert (p.mode_requested, p.mode) == ("accurate", "balanced")


def test_llm_judge_long_accurate_falls_back(table):
    p = route(req(job="llm_judge", tokens=50_000, question="Is the answer polite?", mode="accurate"), table)
    assert p.mode == "balanced" and p.escalate_to == "luna"


def test_over_cap_accurate_falls_back(metrics_table):
    assert not metrics_table.slot("llm_judge", ">32k").modes["accurate"].enabled
    p = route(req(job="llm_judge", tokens=50_000, question="Is the answer polite?", mode="accurate"), metrics_table)
    assert p.mode == "balanced" and p.escalate_to == "luna"


def test_search_arithmetic_from_request_beats_regex(table):
    p = route(req(question="how many refunds over 20 dollars", arithmetic=False), table)
    assert p.slot == "<=2k" and p.arithmetic_source == "request"
    p = route(req(question="was the user happy", arithmetic=True), table)
    assert p.slot == "arithmetic" and p.primary == "haiku"


def test_search_arithmetic_hook_then_regex(table):
    p = route(req(question="was the user happy"), table, hook=lambda q: True)
    assert p.slot == "arithmetic" and p.arithmetic_source == "hook"
    p = route(req(question="what is the total price"), table)
    assert p.slot == "arithmetic" and p.arithmetic_source == "regex"


def test_judge_arithmetic_uses_regex_and_ignores_request(table):
    p = route(req(job="llm_judge", question="The refund amount is correct", arithmetic=False), table)
    assert p.slot == "arithmetic" and p.primary == "luna"


def test_arithmetic_only_on_short_inputs(table):
    p = route(req(question="total price", tokens=20_000), table)
    assert p.slot == "8k-32k" and p.arithmetic


def test_tokens_estimated_when_missing(table):
    p = route(Request(job="search", text="a" * 27_000, question="q"), table)
    assert p.bucket == "8k-32k"


def test_unknown_job_and_mode(table):
    with pytest.raises(ValueError):
        route(req(job="summary"), table)
    with pytest.raises(ValueError):
        route(req(mode="fast"), table)


# ---------- run() with fake clients ----------

def test_instant_one_call(table):
    d = Fake("decisions", ans(True, 0.6, usd=0.0002, ms=210))
    r = run(req(mode="instant"), {"decisions": d}, table)
    assert (r.verdict, r.probability, r.answered_by, r.escalated) == (True, 0.6, "decisions", False)
    assert r.cost_usd == pytest.approx(0.0002) and r.latency_ms == 210 and d.calls == 1


def test_balanced_confident_stays(table):
    d, h = Fake("decisions", ans(False, 0.05)), Fake("haiku", ans(True))
    r = run(req(), {"decisions": d, "haiku": h}, table)
    assert (r.verdict, r.answered_by, r.escalated, h.calls) == (False, "decisions", False, 0)


def test_balanced_unsure_escalates(table):
    d, h = Fake("decisions", ans(False, 0.4, usd=0.0001, ms=200)), Fake("haiku", ans(True, None, usd=0.0004, ms=1500))
    r = run(req(), {"decisions": d, "haiku": h}, table)
    assert (r.verdict, r.answered_by, r.escalated, r.probability) == (True, "haiku", True, None)
    assert r.cost_usd == pytest.approx(0.0005) and r.latency_ms == 1700


def test_escalation_timeout_keeps_primary_flagged(table):
    d, h = Fake("decisions", ans(False, 0.4)), Fake("haiku", BackendTimeout("t"))
    r = run(req(), {"decisions": d, "haiku": h}, table)
    assert (r.verdict, r.answered_by, r.escalated) == (False, "decisions", False)
    assert "escalation_failed" in r.flags and f"haiku_failed:{UNAVAILABLE}" in r.flags


def test_primary_down_escalation_answers(table):
    d, h = Fake("decisions", BackendUnavailable("down")), Fake("haiku", ans(True))
    r = run(req(), {"decisions": d, "haiku": h}, table)
    assert (r.verdict, r.answered_by) == (True, "haiku") and "primary_failed" in r.flags


def test_everything_down_is_a_skip(table):
    d, h = Fake("decisions", BackendCapacity("429")), Fake("haiku", BackendUnavailable("down"))
    r = run(req(), {"decisions": d, "haiku": h}, table)
    assert r.verdict is None and r.skip_reason == UNAVAILABLE and r.answered_by is None


def test_instant_down_names_the_reason(table):
    r = run(req(mode="instant"), {"decisions": Fake("decisions", BackendError("401", KEY_INVALID))}, table)
    assert r.verdict is None and r.skip_reason == KEY_INVALID
    r = run(req(mode="instant"), {"decisions": Fake("decisions", BackendCapacity("429"))}, table)
    assert r.skip_reason == RATE_LIMITED


def test_missing_client_counts_as_down(table):
    r = run(req(), {"decisions": Fake("decisions", ans(False, 0.5))}, table)
    assert r.answered_by == "decisions" and "escalation_failed" in r.flags


# ---------- GPU backends (off by default) ----------

def test_gpu_backends_off_by_default(table):
    assert not table.backends["vega"].enabled and not table.backends["nox"].enabled
    for slot in table.slots.values():
        for e in slot.modes.values():
            if e.enabled:
                assert "vega" not in e.backends and "nox" not in e.backends


def test_confident_pair_takes_the_more_confident():
    t = load(overrides={"vega": True}, use_metrics=False)
    e = Entry(mode="instant", primary="decisions", pair_with="vega")
    plan = plan_for_entry(e, t, job="search", tokens=500, bucket="<=2k", slot="<=2k")
    d, v = Fake("decisions", ans(True, 0.6, usd=0.0001, ms=200)), Fake("vega", ans(False, 0.05, usd=0.0, ms=350))
    r = run(req(), {"decisions": d, "vega": v}, t, plan=plan)
    assert (r.verdict, r.answered_by, r.latency_ms) == (False, "vega", 350)
    # vega down: decisions answers alone, and vega's fallback does not call decisions a second time
    d2, v2 = Fake("decisions", ans(True, 0.6)), Fake("vega", BackendUnavailable("no GPU"))
    r = run(req(), {"decisions": d2, "vega": v2}, t, plan=plan)
    assert (r.verdict, r.answered_by, d2.calls) == (True, "decisions", 1)


def test_vega_unavailable_falls_back_to_decisions():
    t = load(overrides={"vega": True}, use_metrics=False)
    e = Entry(mode="balanced", primary="vega", escalate_to="luna", threshold=0.85)
    plan = plan_for_entry(e, t, job="scenario_judge", tokens=500, bucket="<=2k", slot="arithmetic")
    d, v, l = Fake("decisions", ans(True, 0.97)), Fake("vega", BackendCapacity("queue full")), Fake("luna", ans(False))
    r = run(req(job="scenario_judge"), {"decisions": d, "vega": v, "luna": l}, t, plan=plan)
    assert (r.verdict, r.answered_by, l.calls) == (True, "decisions", 0)
    assert "fallback:vega->decisions" in r.flags
