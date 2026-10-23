"""Offline replay: run the router over stored per-row model outputs. No network, aggregates only.

The rows file (one JSON object per check, no text) and the metrics overlay are private and live outside this package.
    python -m judge_router.replay [rows.jsonl]     # the route table check and the end-to-end replay
"""
from __future__ import annotations

import dataclasses
import json
import os
import sys
from typing import Iterable, Optional

from .clients import Answer, BackendUnavailable, JudgeCall
from .config import ARITHMETIC, JOBS, MODES, Entry, RouteTable, Slot, load
from .router import Request, Result, plan_for_entry, route, run

DEFAULT_ROWS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "replay-rows.jsonl")
JOB_OF_ROW = {"search": "search", "llm-judge": "llm_judge", "simulation-judge": "scenario_judge"}
# backends whose stored rows carry a probability the router may read
PROBABILISTIC = {"decisions", "vega", "jev"}


class RecordedClient:
    """Answers with one row's stored output; a missing or verdict-less row is a down backend."""

    def __init__(self, name: str, leg: Optional[dict]):
        self.name, self.leg = name, leg

    def judge(self, call: JudgeCall, timeout_s: float) -> Answer:
        leg = self.leg
        if not leg or leg.get("pred") is None:
            raise BackendUnavailable("no stored verdict")
        p = leg.get("p") if self.name in PROBABILISTIC else None
        return Answer(verdict=bool(leg["pred"]), probability=p, cost_usd=float(leg.get("usd") or 0.0), latency_ms=float(leg.get("ms") or 0.0))


def load_rows(path: str = DEFAULT_ROWS) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def clients_for(row: dict) -> dict[str, RecordedClient]:
    return {name: RecordedClient(name, leg) for name, leg in row["legs"].items()}


def rows_for(rows: Iterable[dict], job: str, slot: Slot) -> list[dict]:
    mo = slot.measured_on
    if mo is None:
        return []
    return [r for r in rows if JOB_OF_ROW[r["job"]] == job and r["split"] in mo.splits and r["tokens"] >= mo.min_tokens
            and (mo.max_tokens is None or r["tokens"] <= mo.max_tokens)]


@dataclasses.dataclass(frozen=True)
class Score:
    n: int
    score: float  # balanced accuracy, points
    usd_per_1k: float
    p50_ms: float
    escalated: float
    answered: float


def balanced_accuracy(truths: list[bool], preds: list[Optional[bool]]) -> float:
    pos = [p for t, p in zip(truths, preds) if t]
    neg = [p for t, p in zip(truths, preds) if not t]
    if not pos or not neg:
        return float("nan")
    return 100 * (sum(p is True for p in pos) / len(pos) + sum(p is False for p in neg) / len(neg)) / 2


def p50(xs: list[float]) -> float:
    s = sorted(xs)  # the page's quantile: s[floor(0.5 * n)]
    return s[min(len(s) - 1, int(0.5 * len(s)))] if s else float("nan")


def score(rows: list[dict], results: list[Result]) -> Score:
    n = len(rows)
    return Score(n=n, score=balanced_accuracy([r["truth"] for r in rows], [x.verdict for x in results]),
                 usd_per_1k=1000 * sum(x.cost_usd for x in results) / n, p50_ms=p50([x.latency_ms for x in results]),
                 escalated=sum(x.escalated or "primary_failed" in x.flags for x in results) / n,
                 answered=sum(x.verdict is not None for x in results) / n)


def replay_entry(rows: list[dict], table: RouteTable, job: str, slot: Slot, e: Entry) -> Score:
    results = []
    for r in rows:
        plan = plan_for_entry(e, table, job=job, tokens=r["tokens"], bucket=slot.key, slot=slot.key)
        req = Request(job=job, text="", question="", tokens=r["tokens"])
        results.append(run(req, clients_for(r), table, plan=plan))
    return score(rows, results)


def check_table(rows: list[dict], table: RouteTable) -> list[dict]:
    """Every measured entry of the table (modes and alternatives) recomputed from the rows, next to its stated metrics."""
    out = []
    seen = set()
    for (job, key), slot in table.slots.items():
        rs = rows_for(rows, job, slot)
        sig = (job, slot.measured_on)
        for e in list(slot.modes.values()) + list(slot.alternatives):
            if e.metrics is None or e.page_only or not rs:
                continue
            k = (sig, e.mode in slot.modes and slot.modes.get(e.mode) is e, e.primary, e.escalate_to, e.threshold, e.pair_with)
            if k in seen:  # shared slots (anchors) are checked once
                continue
            seen.add(k)
            s = replay_entry(rs, table, job, slot, e)
            out.append({"job": job, "slot": key, "mode": e.mode, "route": describe(e), "enabled": e.enabled,
                        "stated": dataclasses.asdict(e.metrics), "replay": dataclasses.asdict(s)})
    return out


def describe(e: Entry) -> str:
    if e.pair_with:
        return f"{e.primary} + {e.pair_with} (confident pair)"
    if e.escalate_to:
        return f"{e.primary} -> {e.escalate_to} @ |2p-1| < {e.threshold}"
    return e.primary


def end_to_end(rows: list[dict], table: RouteTable, mode: Optional[str] = None) -> dict:
    """Route every stored check as the router would (arithmetic flag = the stored regex flag) and score per set and job."""
    t = dataclasses.replace(table, arithmetic_source={j: "request" for j in JOBS})
    out = {}
    for split in ("core", "long-bench", "hard-bench"):
        for job_row, job in JOB_OF_ROW.items():
            rs = [r for r in rows if r["split"] == split and r["job"] == job_row]
            if not rs:
                continue
            results = [run(Request(job=job, text="", question="", tokens=r["tokens"], arithmetic=r["arithFlag"], mode=mode),
                           clients_for(r), t) for r in rs]
            slots: dict[str, int] = {}
            for x in results:
                k = f"{x.plan.slot}/{x.plan.mode}"
                slots[k] = slots.get(k, 0) + 1
            out[f"{split}/{job}"] = {**dataclasses.asdict(score(rs, results)), "slots": slots}
    return out


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else DEFAULT_ROWS
    rows = load_rows(path)
    table = load()
    print(f"rows: {len(rows)} (aggregates only)\n")
    print("Route table check: stated vs replayed (balanced accuracy, $/1k, p50 ms)")
    worst = 0.0
    for c in check_table(rows, table):
        s, r = c["stated"], c["replay"]
        d = abs(s["score"] - r["score"])
        worst = max(worst, d)
        print(f"  {'on ' if c['enabled'] else 'off'} {c['job']:14s} {c['slot']:10s} {c['mode']:8s} {c['route']:38s} "
              f"stated {s['score']:5.1f} ${s['usd_per_1k']:6.2f} {s['p50_ms']:6.0f}  replay {r['score']:5.1f} ${r['usd_per_1k']:6.2f} {r['p50_ms']:6.0f}  n={r['n']}")
    print(f"\nlargest score gap: {worst:.2f} points\n")
    for mode in MODES:
        print(f"End to end, mode {mode} (every check routed by token count and the regex arithmetic flag)")
        for k, v in end_to_end(rows, table, mode).items():
            print(f"  {k:28s} n={v['n']:4d}  BA {v['score']:5.1f}  ${v['usd_per_1k']:5.2f}/1k  p50 {v['p50_ms']:6.0f} ms  escalated {100 * v['escalated']:3.0f}%  {v['slots']}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
