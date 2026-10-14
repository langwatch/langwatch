"""Record the Go topic-clustering parity fixtures from this Python package.

Design: dev/docs/plans/langevals-go/topic-clustering-go.md section 7. No keys, no
network: litellm.embedding answers from a SplitMix64 generator that the Go tests
reimplement bit for bit, and litellm.completion answers names by sample prefix.

Run from the repository root:
  uv run --project services/langevals/evaluators/topic_clustering \
    python services/langevals/evaluators/topic_clustering/scripts/record_go_fixtures.py
"""

import json
import os
import sys
from types import SimpleNamespace

import litellm
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scipy.cluster.hierarchy import fcluster, linkage

import langevals_topic_clustering.batch_clustering as batch_clustering
import langevals_topic_clustering.incremental_clustering as incremental_clustering
import langevals_topic_clustering.topic_naming as topic_naming
from langevals_topic_clustering.utils import calculate_centroid_and_distance

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../.."))
EVALUATORS = os.path.join(ROOT, "services/nlpgo/modules/evaluators")
RULES_DATA = os.path.join(EVALUATORS, "rules/testdata/clustering")
SERVICES_DATA = os.path.join(EVALUATORS, "services/testdata/clustering")
PROMPTS = os.path.join(EVALUATORS, "rules/prompts")

DIM = 1536
GAMMA = np.uint64(0x9E3779B97F4A7C15)
MASK = (1 << 64) - 1
COST_PER_CALL = 0.001


# ---- the shared generator (mirrored in Go: synthetic_test.go) ----


def noise(seed: int) -> np.ndarray:
    """DIM Irwin-Hall(4) values from SplitMix64 seeded with seed."""
    k = np.arange(1, 4 * DIM + 1, dtype=np.uint64)
    with np.errstate(over="ignore"):
        z = np.uint64(seed & MASK) + GAMMA * k
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        z = z ^ (z >> np.uint64(31))
    u = (z >> np.uint64(11)).astype(np.float64) * (2.0**-53)
    u = u.reshape(DIM, 4)
    return u[:, 0] + u[:, 1] + u[:, 2] + u[:, 3] - 2.0


def spread(t: int, s: int) -> tuple[float, float]:
    """Subtopic offset and point noise scales; themes 8+ and subtopics 7+ are tighter."""
    if s >= 7:
        return (0.3, 0.2)
    return (0.5, 0.3) if t < 8 else (0.4, 0.2)


def vector_for(text: str) -> list[float]:
    """Unit vector for an input "tNN sM qQQQ", rounded to float32."""
    t, s, q = (int(part[1:]) for part in text.split(" ")[:3])
    b, c = spread(t, s)
    v = noise(1000 + t) + b * noise(2_000_000 + t * 1000 + s)
    v = v + c * noise(3_000_000_000 + t * 1_000_000 + s * 10_000 + q)
    norm = np.sqrt(np.cumsum(v * v)[-1])
    return [float(x) for x in (v / norm).astype(np.float32)]


def name_vector(name: str) -> list[float]:
    v = [0.0] * DIM
    parts = name.split(" ")
    if len(parts) >= 1 and parts[0].startswith("t") and parts[0][1:].isdigit():
        index = int(parts[0][1:]) * 10
        if len(parts) >= 2 and parts[1].startswith("s") and parts[1][1:].isdigit():
            index += int(parts[1][1:]) + 1
        v[index] = 1.0
    else:
        v[DIM - 1] = 1.0
    return v


def traces_for(spec: list[tuple[int, int, int, int, int]]) -> list[dict]:
    """(topic, subtopic, first q, count, distinct) -> traces; q cycles over distinct."""
    traces = []
    for t, s, first, count, distinct in spec:
        for i in range(count):
            q = first + (i % distinct)
            traces.append(
                {
                    "trace_id": f"tr-{t:02d}-{s}-{first + i:03d}",
                    "input": f"t{t:02d} s{s} q{q:03d}",
                    "topic_id": None,
                    "subtopic_id": None,
                }
            )
    return traces


def grid(topics: range, subtopics: int, count: int, distinct: int, first=0):
    return [(t, s, first, count, distinct) for t in topics for s in range(subtopics)]


# ---- scripted litellm ----


def scripted_name(samples: list[str]) -> str:
    heads = {" ".join(sample.split(" ")[:2]) for sample in samples}
    if len(heads) == 1:
        return heads.pop()
    topics = {sample.split(" ")[0] for sample in samples}
    return topics.pop() if len(topics) == 1 else "mixed"


def parse_topics(user: str) -> list[list[str]]:
    sections = user.split("\n\n\n")
    return [section.split("\n\n", 1)[1].split("\n") if "\n\n" in section else [] for section in sections]


captured: list[dict] = []


def fake_completion(**kwargs):
    captured.append(kwargs)
    properties = kwargs["tools"][0]["function"]["parameters"]["properties"]
    user = kwargs["messages"][1]["content"]
    if "topic_a" in properties:
        a = user.split("\n\n", 1)[0].removeprefix("# Topic A: ")
        b = user.split("# Topic B: ", 1)[1].split("\n\n", 1)[0]
        answer = {"topic_a": a + " a", "topic_b": b + " b"}
    else:
        answer = {f"topic_{i}": scripted_name(samples) for i, samples in enumerate(parse_topics(user))}
    call = SimpleNamespace(function=SimpleNamespace(arguments=json.dumps(answer)))
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[call]))])


def fake_embedding(**kwargs):
    inputs = kwargs["input"] if isinstance(kwargs["input"], list) else [kwargs["input"]]
    data = []
    for text in inputs:
        parts = text.split(" ")
        is_trace = len(parts) >= 3 and parts[2].startswith("q")
        data.append({"embedding": vector_for(text) if is_trace else name_vector(text)})
    return SimpleNamespace(data=data)


litellm.embedding = fake_embedding
litellm.completion = fake_completion
topic_naming.completion_cost = lambda _response: COST_PER_CALL


# ---- fixtures ----


def linkage_case(name: str, spec) -> dict:
    traces = traces_for(spec)
    vectors = np.array([vector_for(t["input"]) for t in traces])
    Z = linkage(vectors, "ward")
    labels4 = fcluster(Z, 4, criterion="distance")
    labels2 = fcluster(Z, 2, criterion="distance")
    clusters = []
    for label in sorted(set(labels4)):
        members = [{"embeddings": vectors[i]} for i in range(len(traces)) if labels4[i] == label]
        centroid, p95 = calculate_centroid_and_distance(members)
        clusters.append({"label": int(label), "p95": float(p95), "centroid_probe": [float(x) for x in centroid[::64]]})
    p95s = sorted(round(c["p95"], 3) for c in clusters)
    print(f"{name}: n={len(traces)} clusters@4={labels4.max()} clusters@2={labels2.max()} p95={p95s[:3]}..{p95s[-3:]} maxZ={Z[-3:,2]}", file=sys.stderr)
    return {
        "name": name,
        "spec": spec,
        "vector_probe": [[i, j, float(vectors[i][j])] for i in (0, len(traces) - 1) for j in (0, 1, DIM - 1)],
        "z": [[int(a), int(b), float(h), int(size)] for a, b, h, size in Z],
        "labels4": [int(x) for x in labels4],
        "labels2": [int(x) for x in labels2],
        "clusters4": clusters,
    }


def hierarchy_case(name: str, spec, maximum_p95: float) -> dict:
    traces = traces_for(spec)
    with_vectors = [{**t, "embeddings": vector_for(t["input"])} for t in traces]
    hierarchy = batch_clustering.build_hierarchy(with_vectors, 4, maximum_p95_distance=maximum_p95)
    topics = [
        {"key": key, "subtopics": [{"key": k, "trace_ids": [t["trace_id"] for t in members]} for k, members in subtopics.items()]}
        for key, subtopics in hierarchy.items()
    ]
    print(f"{name}: topics={len(topics)} subtopics={sum(len(t['subtopics']) for t in topics)}", file=sys.stderr)
    return {"name": name, "spec": spec, "maximum_p95": maximum_p95, "topics": topics}


def names_by_id(response: dict, topics: list[dict], subtopics: list[dict]) -> dict:
    return {item["id"]: item["name"] for item in response["topics"] + response["subtopics"] + topics + subtopics}


def service_case(client, name: str, path: str, spec, existing=None) -> dict:
    traces = traces_for(spec)
    body = {
        "project_id": "project_fixture",
        "traces": traces,
        "litellm_params": {"model": "openai/gpt-5-mini", "api_key": "test"},
        "embeddings_litellm_params": {"model": "openai/text-embedding-3-small", "api_key": "test", "dimensions": DIM},
    }
    topics, subtopics = [], []
    if existing:
        for topic in existing:
            members = [{"embeddings": vector_for(text)} for text in topic["inputs"]]
            centroid, p95 = calculate_centroid_and_distance(members)
            topics.append({"id": topic["id"], "name": topic["name"], "centroid": centroid.tolist(), "p95_distance": float(p95)})
            for sub in topic["subtopics"]:
                members = [{"embeddings": vector_for(text)} for text in sub["inputs"]]
                centroid, p95 = calculate_centroid_and_distance(members)
                subtopics.append({"id": sub["id"], "name": sub["name"], "centroid": centroid.tolist(), "p95_distance": float(p95), "parent_id": topic["id"]})
        body["topics"], body["subtopics"] = topics, subtopics
    captured.clear()
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    out = response.json()
    names = names_by_id(out, topics, subtopics)
    rows = [[row["trace_id"], names.get(row["topic_id"], "<unknown>") if row["topic_id"] else None, names.get(row["subtopic_id"]) if row["subtopic_id"] else None] for row in out["traces"]]
    parents = {t["id"]: t["name"] for t in out["topics"] + topics}
    print(f"{name}: topics={len(out['topics'])} subtopics={len(out['subtopics'])} rows={len(rows)} calls={len(captured)}", file=sys.stderr)
    return {
        "name": name,
        "spec": spec,
        "existing": existing or [],
        "topics": sorted(t["name"] for t in out["topics"]),
        "subtopics": sorted([s["name"], parents.get(s["parent_id"], "<unknown>")] for s in out["subtopics"]),
        "rows": rows,
        "cost": out["cost"]["amount"],
    }


def existing_from(case: dict, spec) -> list[dict]:
    """Existing topics for incremental runs: the batch case's membership."""
    inputs = {t["trace_id"]: t["input"] for t in traces_for(spec)}
    topics: dict[str, dict] = {}
    for trace_id, topic, subtopic in case["rows"]:
        if topic is None:
            continue
        entry = topics.setdefault(topic, {"id": f"topic_{topic.replace(' ', '_')}", "name": topic, "inputs": [], "subs": {}})
        entry["inputs"].append(inputs[trace_id])
        if subtopic is not None:
            entry["subs"].setdefault(subtopic, []).append(inputs[trace_id])
    return [
        {"id": t["id"], "name": t["name"], "inputs": t["inputs"], "subtopics": [{"id": f"subtopic_{k.replace(' ', '_')}", "name": k, "inputs": v} for k, v in t["subs"].items()]}
        for t in topics.values()
    ]


def prompts() -> dict:
    captured.clear()
    params = {"model": "openai/gpt-5-mini"}
    topic_naming.generate_topic_names(params, [["t01 s0 q001", "t01 s0 q002"], ["t02 s1 q003"]])
    topic_naming.generate_topic_names(params, [["t01 s0 q001"]], existing=["Billing", "Refunds"])
    topic_naming.improve_name_between_two_topics(params, "Billing", "Payments", ["t01 s0 q001", "x"], ["t02 s1 q003"])
    plain, existing, pair = captured
    suffix = existing["messages"][0]["content"].removeprefix(plain["messages"][0]["content"])
    with open(os.path.join(PROMPTS, "topic_names.tmpl"), "w") as f:
        f.write(plain["messages"][0]["content"] + "{{.Existing}}")
    with open(os.path.join(PROMPTS, "topic_names_existing.tmpl"), "w") as f:
        f.write(suffix.replace("Billing\nRefunds", "{{.Names}}"))
    with open(os.path.join(PROMPTS, "topic_pair_names.tmpl"), "w") as f:
        f.write(pair["messages"][0]["content"])
    strip = lambda call: {"messages": call["messages"], "tools": call["tools"], "tool_choice": call["tool_choice"], "temperature": call["temperature"]}
    return {"names": strip(plain), "names_existing": strip(existing), "pair": strip(pair)}


def write(path: str, value) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(value, f, separators=(",", ":"))


def main() -> None:
    os.makedirs(PROMPTS, exist_ok=True)
    write(os.path.join(RULES_DATA, "prompts.json"), prompts())
    write(
        os.path.join(RULES_DATA, "linkage.json"),
        [
            linkage_case("n48", grid(range(2), 2, 12, 12)),
            linkage_case("n480", grid(range(8), 3, 20, 19)),
            linkage_case("n480_dup60", grid(range(8), 3, 20, 8)),
            linkage_case("n2016", grid(range(12), 3, 56, 53)),
        ],
    )
    write(
        os.path.join(RULES_DATA, "hierarchy.json"),
        [
            hierarchy_case("base", grid(range(6), 3, 20, 20), 1.0),
            hierarchy_case("few_distinct", grid(range(3), 3, 20, 4) + grid(range(3, 5), 2, 20, 20), 1.0),
            hierarchy_case("tight_ceiling", grid(range(8, 10), 3, 20, 20) + grid(range(3), 3, 20, 20), 0.08),
        ],
    )

    rng = np.random.default_rng(7)
    means = []
    for n in (3, 8, 20, 130, 300):
        values = [float(x) for x in rng.random(n)]
        means.append({"values": values, "mean": float(np.mean(values))})
    write(os.path.join(RULES_DATA, "means.json"), means)

    app = FastAPI()
    batch_clustering.setup_endpoints(app)
    incremental_clustering.setup_endpoints(app)
    client = TestClient(app)
    base_spec = grid(range(6), 3, 20, 20)
    base = service_case(client, "base", "/topics/batch_clustering", base_spec)
    existing = existing_from(base, base_spec)
    known = [(0, 0, 100, 10, 10), (1, 1, 100, 10, 10), (2, 2, 100, 10, 10)]
    grow = service_case(client, "grow", "/topics/incremental_clustering", known + [(3, 7, 100, 60, 60)] + grid(range(8, 10), 3, 20, 20, first=100), existing)
    few = service_case(client, "few", "/topics/incremental_clustering", known + [(3, 7, 100, 49, 49)] + [(8, 0, 100, 34, 34), (8, 1, 100, 33, 33), (8, 2, 100, 33, 33)], existing)
    write(os.path.join(SERVICES_DATA, "cases.json"), [base, grow, few])


if __name__ == "__main__":
    main()
