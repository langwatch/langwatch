"""Route table: routes.yaml (routing only) plus an optional metrics overlay, loaded into plain dataclasses.

routes.metrics.yaml beside routes.yaml (or `metrics_path`) adds per-entry metrics, history and the alternatives. It is
private: without it the router runs the same routes with no expected metrics.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Optional

import yaml

JOBS = ("search", "llm_judge", "scenario_judge")
MODES = ("instant", "balanced", "accurate")
# accurate falls back to balanced, balanced to instant
MODE_FALLBACK = {"accurate": "balanced", "balanced": "instant", "instant": None}
ARITHMETIC = "arithmetic"
ROUTING_KEYS = ("primary", "escalate_to", "threshold", "pair_with")
DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes.yaml")


def metrics_path_for(path: str) -> str:
    """The overlay that load() looks for next to a route table: routes.yaml -> routes.metrics.yaml."""
    root, ext = os.path.splitext(path)
    return f"{root}.metrics{ext or '.yaml'}"


DEFAULT_METRICS_PATH = metrics_path_for(DEFAULT_PATH)


@dataclass(frozen=True)
class Metrics:
    score: float
    usd_per_1k: float
    p50_ms: float
    n: int
    escalated: Optional[float] = None


@dataclass(frozen=True)
class Entry:
    mode: str
    primary: str
    escalate_to: Optional[str] = None
    threshold: Optional[float] = None
    pair_with: Optional[str] = None
    metrics: Optional[Metrics] = None
    enabled: bool = True
    disabled_why: Optional[str] = None
    note: Optional[str] = None
    replaces: Optional[dict] = None
    was: Optional[dict] = None
    page_only: bool = False

    @property
    def backends(self) -> tuple[str, ...]:
        return tuple(b for b in (self.primary, self.escalate_to, self.pair_with) if b)


@dataclass(frozen=True)
class MeasuredOn:
    splits: tuple[str, ...]
    min_tokens: int
    max_tokens: Optional[int]


@dataclass(frozen=True)
class Slot:
    job: str
    key: str  # a bucket name or "arithmetic"
    modes: dict[str, Entry]
    alternatives: tuple[Entry, ...]
    measured_on: Optional[MeasuredOn]


@dataclass(frozen=True)
class Backend:
    name: str
    kind: str
    enabled: bool
    timeout_s: float = 30.0
    model: Optional[str] = None
    gpu: bool = False
    fallbacks: tuple[str, ...] = ()


@dataclass(frozen=True)
class Bucket:
    name: str
    max_tokens: Optional[int]


@dataclass
class RouteTable:
    max_usd_per_1k: float
    default_mode: dict[str, str]
    buckets: list[Bucket]
    arithmetic_max_tokens: int
    arithmetic_source: dict[str, str]
    backends: dict[str, Backend]
    slots: dict[tuple[str, str], Slot] = field(default_factory=dict)
    has_metrics: bool = False

    def slot(self, job: str, key: str) -> Slot:
        return self.slots[(job, key)]

    def bucket_of(self, tokens: int) -> str:
        for b in self.buckets:
            if b.max_tokens is None or tokens <= b.max_tokens:
                return b.name
        raise ValueError("buckets must end with an open bucket")


def _metrics(d: Any) -> Optional[Metrics]:
    if not d:
        return None
    return Metrics(score=float(d["score"]), usd_per_1k=float(d["usd_per_1k"]), p50_ms=float(d["p50_ms"]), n=int(d["n"]),
                   escalated=d.get("escalated"))


def _entry(mode: str, d: dict, backends: dict[str, Backend], max_usd: float, forced_off: Optional[str] = None) -> Entry:
    """Enabled when every backend it names is enabled and, if it has metrics, it costs under the cap."""
    m = _metrics(d.get("metrics"))
    why = forced_off
    if why is None:
        off = [b for b in (d["primary"], d.get("escalate_to"), d.get("pair_with")) if b and not (b in backends and backends[b].enabled)]
        if off:
            why = "backend off: " + ", ".join(off)
        elif m is not None and m.usd_per_1k >= max_usd:
            why = f"${m.usd_per_1k:.2f} per 1k is not under ${max_usd:.0f}"
    return Entry(mode=mode, primary=d["primary"], escalate_to=d.get("escalate_to"), threshold=d.get("threshold"),
                 pair_with=d.get("pair_with"), metrics=m, enabled=why is None, disabled_why=why, note=d.get("note"),
                 replaces=d.get("replaces"), was=d.get("was"), page_only=bool(d.get("page_only", False)))


def _merge_entry(where: str, base: Optional[dict], extra: Optional[dict]) -> Optional[dict]:
    """A route entry with its overlay fields. The overlay may add a mode, but may not change an existing route."""
    if not extra:
        return base
    if base is None:
        return dict(extra)
    clash = [k for k in ROUTING_KEYS if k in extra and extra[k] != base.get(k)]
    if clash:
        raise ValueError(f"{where}: the metrics overlay changes the route ({', '.join(clash)})")
    return {**base, **extra}


def apply_overlay(raw: dict, overlay: dict) -> dict:
    """routes.yaml content with the overlay's extra backends and per-slot fields merged in."""
    out = {**raw, "backends": dict(raw["backends"]), "routes": {}}
    for name, b in (overlay.get("backends") or {}).items():
        out["backends"][name] = {**raw["backends"][name], **b} if name in raw["backends"] else b
    unknown = [(job, key) for job, slots in (overlay.get("routes") or {}).items() for key in slots
               if key not in (raw["routes"].get(job) or {})]
    if unknown:
        raise ValueError(f"the metrics overlay names slots the route table does not have: {unknown}")
    for job, slots in raw["routes"].items():
        out["routes"][job] = {}
        for key, s in slots.items():
            extra = ((overlay.get("routes") or {}).get(job) or {}).get(key) or {}
            merged = dict(s)
            for m in MODES:
                merged[m] = _merge_entry(f"{job} / {key} / {m}", s.get(m), extra.get(m))
            for k in ("measured_on", "alternatives"):
                if k in extra:
                    merged[k] = extra[k]
            out["routes"][job][key] = merged
    return out


def _read(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f) or {}


def load(path: str = DEFAULT_PATH, overrides: Optional[dict[str, bool]] = None, metrics_path: Optional[str] = None,
         use_metrics: bool = True) -> RouteTable:
    """Load the route table, plus the metrics overlay when present (`metrics_path`, else beside `path`).

    `overrides` turns backends on or off by name (e.g. {"vega": True} once it is served). use_metrics=False ignores
    the overlay. An explicit `metrics_path` that does not exist is an error; a missing default overlay is not.
    """
    raw = _read(path)
    mpath = metrics_path or metrics_path_for(path)
    has_metrics = use_metrics and (metrics_path is not None or os.path.exists(mpath))
    if has_metrics:
        raw = apply_overlay(raw, _read(mpath))
    backends = {}
    for name, b in raw["backends"].items():
        enabled = bool(b.get("enabled", False))
        if overrides and name in overrides:
            enabled = overrides[name]
        backends[name] = Backend(name=name, kind=b["kind"], enabled=enabled, timeout_s=float(b.get("timeout_s", 30)),
                                 model=b.get("model"), gpu=bool(b.get("gpu", False)), fallbacks=tuple(b.get("fallbacks", ())))
    t = RouteTable(max_usd_per_1k=float(raw["max_usd_per_1k"]), default_mode=dict(raw["default_mode"]),
                   buckets=[Bucket(b["name"], b["max_tokens"]) for b in raw["buckets"]],
                   arithmetic_max_tokens=int(raw["arithmetic"]["max_tokens"]),
                   arithmetic_source=dict(raw["arithmetic"]["source"]), backends=backends, has_metrics=has_metrics)
    for job, slots in raw["routes"].items():
        for key, s in slots.items():
            modes = {m: _entry(m, s[m], backends, t.max_usd_per_1k) for m in MODES if s.get(m)}
            alts = tuple(_entry(a["mode"], a, backends, t.max_usd_per_1k, forced_off=a.get("why", "alternative")) for a in s.get("alternatives") or [])
            mo = s.get("measured_on")
            t.slots[(job, key)] = Slot(job=job, key=key, modes=modes, alternatives=alts,
                                       measured_on=MeasuredOn(tuple(mo["splits"]), int(mo["min_tokens"]), mo["max_tokens"]) if mo else None)
    validate(t)
    return t


def validate(t: RouteTable) -> None:
    for job in JOBS:
        if t.default_mode.get(job) not in MODES:
            raise ValueError(f"default mode for {job} missing")
        for key in [b.name for b in t.buckets] + [ARITHMETIC]:
            s = t.slots.get((job, key))
            if s is None:
                raise ValueError(f"route table has no slot {job} / {key}")
            if "instant" not in s.modes or not s.modes["instant"].enabled:
                raise ValueError(f"{job} / {key}: an enabled instant entry is required (the end of every fallback)")
            for e in list(s.modes.values()) + list(s.alternatives):
                for b in e.backends:
                    if b not in t.backends:
                        raise ValueError(f"{job} / {key}: unknown backend {b}")
                if e.escalate_to and e.threshold is None:
                    raise ValueError(f"{job} / {key} / {e.mode}: escalate_to needs a threshold")
    for b in t.backends.values():
        for f in b.fallbacks:
            if f not in t.backends:
                raise ValueError(f"backend {b.name}: unknown fallback {f}")
