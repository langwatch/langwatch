"""The router: route() is a pure function from a request to a plan; run() executes a plan against clients.

Modes, the escalation rule, the confident pair and the fallbacks are described in README.md.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Mapping, Optional

from .clients import UNAVAILABLE, Answer, BackendError, Client, JudgeCall
from .config import ARITHMETIC, JOBS, MODE_FALLBACK, MODES, Entry, Metrics, RouteTable
from .features import ArithmeticHook, arithmetic_flag, estimate_tokens


@dataclass(frozen=True)
class Request:
    job: str  # search | llm_judge | scenario_judge
    text: str  # the full hydrated input
    question: str  # search question, evaluator prompt, or scenario criterion
    scenario: Optional[str] = None
    tokens: Optional[int] = None  # token count of the full input; estimated from bytes when missing
    arithmetic: Optional[bool] = None  # e.g. from the search rewrite call
    mode: Optional[str] = None  # instant | balanced | accurate; the job's default when missing


@dataclass(frozen=True)
class Plan:
    job: str
    tokens: int
    bucket: str
    slot: str  # the bucket, or "arithmetic"
    arithmetic: bool
    arithmetic_source: str
    mode_requested: str
    mode: str
    primary: str
    escalate_to: Optional[str]
    threshold: Optional[float]
    pair_with: Optional[str]
    expected: Optional[Metrics]
    fallbacks: Mapping[str, tuple[str, ...]]

    @property
    def order(self) -> tuple[str, ...]:
        """Models in the order they may be called."""
        return tuple(b for b in (self.primary, self.pair_with, self.escalate_to) if b)


@dataclass(frozen=True)
class Call:
    backend: str
    ok: bool
    cost_usd: float
    latency_ms: float
    reason: Optional[str] = None


@dataclass(frozen=True)
class Result:
    verdict: Optional[bool]
    probability: Optional[float]  # P(yes) of the model that answered, when it gives one
    answered_by: Optional[str]
    escalated: bool
    cost_usd: float
    latency_ms: float
    plan: Plan
    flags: tuple[str, ...] = ()
    skip_reason: Optional[str] = None
    calls: tuple[Call, ...] = field(default_factory=tuple)


def unsure(p: Optional[float], threshold: float) -> bool:
    """Escalate when |2p - 1| < threshold (threshold 0.7: 0.15 < p < 0.85). No p means unsure."""
    return p is None or abs(2 * p - 1) < threshold


def _pick_mode(slot_modes: Mapping[str, Entry], requested: str) -> tuple[str, Entry]:
    m: Optional[str] = requested
    while m is not None:
        e = slot_modes.get(m)
        if e is not None and e.enabled:
            return m, e
        m = MODE_FALLBACK[m]
    raise LookupError("no enabled entry (config validation should have caught this)")


def route(req: Request, table: RouteTable, hook: Optional[ArithmeticHook] = None) -> Plan:
    if req.job not in JOBS:
        raise ValueError(f"unknown job {req.job!r}")
    requested = req.mode or table.default_mode[req.job]
    if requested not in MODES:
        raise ValueError(f"unknown mode {requested!r}")
    tokens = req.tokens if req.tokens is not None else estimate_tokens(req.text)
    bucket = table.bucket_of(tokens)
    flag, source = arithmetic_flag(req.job, req.question, req.arithmetic, table.arithmetic_source[req.job], hook)
    key = ARITHMETIC if flag and tokens <= table.arithmetic_max_tokens else bucket
    mode, e = _pick_mode(table.slot(req.job, key).modes, requested)
    return plan_for_entry(e, table, job=req.job, tokens=tokens, bucket=bucket, slot=key, arithmetic=flag,
                          arithmetic_source=source, mode_requested=requested, mode=mode)


def plan_for_entry(e: Entry, table: RouteTable, *, job: str, tokens: int, bucket: str, slot: str, arithmetic: bool = False,
                   arithmetic_source: str = "none", mode_requested: Optional[str] = None, mode: Optional[str] = None) -> Plan:
    """A plan for one route table entry (route() uses it; the replay uses it to score an entry directly)."""
    fb = {b: tuple(f for f in table.backends[b].fallbacks if table.backends[f].enabled) for b in e.backends}
    return Plan(job=job, tokens=tokens, bucket=bucket, slot=slot, arithmetic=arithmetic, arithmetic_source=arithmetic_source,
                mode_requested=mode_requested or e.mode, mode=mode or e.mode, primary=e.primary, escalate_to=e.escalate_to,
                threshold=e.threshold, pair_with=e.pair_with, expected=e.metrics, fallbacks=fb)


class _Runner:
    def __init__(self, plan: Plan, call: JudgeCall, clients: Mapping[str, Client], table: RouteTable):
        self.plan, self.call, self.clients, self.table = plan, call, clients, table
        self.calls: list[Call] = []
        self.flags: list[str] = []

    def one(self, backend: str, skip: tuple[str, ...] = ()) -> tuple[Optional[str], Optional[Answer], Optional[str]]:
        """Call a backend, then its fallbacks (except those in `skip`). (who answered, answer, last failure reason)."""
        reason = None
        for b in (backend,) + tuple(f for f in self.plan.fallbacks.get(backend, ()) if f not in skip):
            client = self.clients.get(b)
            if client is None:
                self.calls.append(Call(b, False, 0.0, 0.0, UNAVAILABLE))
                reason = UNAVAILABLE
                self.flags.append(f"{b}_unavailable")
                continue
            try:
                a = client.judge(self.call, self.table.backends[b].timeout_s)
            except BackendError as e:
                self.calls.append(Call(b, False, 0.0, 0.0, e.reason))
                reason = e.reason
                self.flags.append(f"{b}_failed:{e.reason}")
                continue
            if b != backend:
                self.flags.append(f"fallback:{backend}->{b}")
            self.calls.append(Call(b, True, a.cost_usd, a.latency_ms))
            return b, a, None
        return None, None, reason

    def cost(self) -> float:
        return sum(c.cost_usd for c in self.calls)

    def result(self, who, a: Optional[Answer], escalated: bool, latency: float, skip: Optional[str] = None) -> Result:
        return Result(verdict=a.verdict if a else None, probability=a.probability if a else None, answered_by=who,
                      escalated=escalated, cost_usd=self.cost(), latency_ms=latency, plan=self.plan,
                      flags=tuple(self.flags), skip_reason=skip if a is None else None, calls=tuple(self.calls))


def run(req: Request, clients: Mapping[str, Client], table: RouteTable, hook: Optional[ArithmeticHook] = None,
        plan: Optional[Plan] = None) -> Result:
    plan = plan or route(req, table, hook)
    r = _Runner(plan, JudgeCall(job=req.job, text=req.text, question=req.question, scenario=req.scenario), clients, table)

    if plan.pair_with:
        with ThreadPoolExecutor(max_workers=2) as ex:
            # the pair's fallbacks never call the other leg's model twice
            fa = ex.submit(r.one, plan.primary, (plan.pair_with,))
            fb = ex.submit(r.one, plan.pair_with, (plan.primary,))
            (wa, a, ra), (wb, b, _) = fa.result(), fb.result()
        lat = max([x.latency_ms for x in (a, b) if x] or [0.0])
        conf = lambda x: abs(2 * x.probability - 1) if x and x.probability is not None else -1.0
        if a is None and b is None:
            return r.result(None, None, False, lat, ra or UNAVAILABLE)
        who, win = (wa, a) if conf(a) >= conf(b) else (wb, b)
        return r.result(who, win, False, lat)

    who, a, reason = r.one(plan.primary)
    lat = a.latency_ms if a else 0.0
    if a is None:
        if not plan.escalate_to:
            return r.result(None, None, False, lat, reason)
        r.flags.append("primary_failed")
        who2, b, reason2 = r.one(plan.escalate_to)
        return r.result(who2, b, b is not None, lat + (b.latency_ms if b else 0.0), reason2)

    if plan.escalate_to and unsure(a.probability, plan.threshold):
        who2, b, _ = r.one(plan.escalate_to)
        if b is None:
            r.flags.append("escalation_failed")
            return r.result(who, a, False, lat)
        return r.result(who2, b, True, lat + b.latency_ms)
    return r.result(who, a, False, lat)
