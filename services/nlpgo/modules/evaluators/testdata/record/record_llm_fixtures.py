"""Record langevals' LLM and embedding evaluators with every model call they make.

Run: uv run --project services/langevals python \
  services/nlpgo/modules/evaluators/testdata/record/record_llm_fixtures.py [stems...]
The model is fake_llm.py on 127.0.0.1, reached through litellm with the
tenant's X_LITELLM_* params and a dummy key. FORMAT.md describes the output.
"""

import json
import os
import sys

# off_topic builds its intent enum from a set: pin string hashing so the
# recorded tool schema is the same on every run.
if os.environ.get("PYTHONHASHSEED") != "0":
    os.execve(sys.executable, [sys.executable, *sys.argv], {**os.environ, "PYTHONHASHSEED": "0"})

# Scrubs every provider key and base before anything imports litellm.
from record_fixtures import CORPUS, FIXTURES, load_evaluator, wire

import dspy  # noqa: E402
from fake_llm import FakeLLM  # noqa: E402
from langevals.utils import get_evaluator_definitions  # noqa: E402

LLM_EVALUATORS = [
    "langevals__llm_boolean",
    "langevals__llm_score",
    "langevals__llm_category",
    "langevals__llm_answer_match",
    "langevals__competitor_llm",
    "langevals__competitor_llm_function_call",
    "langevals__off_topic",
    "langevals__query_resolution",
    "langevals__select_best_compare",
    "langevals__similarity",
    "langevals__sentiment",
    "ragas__faithfulness",
    "ragas__factual_correctness",
    "ragas__response_context_recall",
    "ragas__response_context_precision",
    "ragas__response_relevancy",
    "ragas__summarization_score",
    "ragas__rubrics_based_scoring",
    "ragas__sql_query_equivalence",
]

# The key is never checked; the base is the fake server's address.
DUMMY_KEY = "sk-recorded"


def tenant_env(url: str, extra: dict) -> dict:
    return {
        "X_LITELLM_api_key": DUMMY_KEY,
        "X_LITELLM_api_base": url,
        "X_LITELLM_EMBEDDINGS_api_key": DUMMY_KEY,
        "X_LITELLM_EMBEDDINGS_api_base": url,
        **extra,
    }


def record(stem: str, server: FakeLLM) -> int:
    family, name = stem.split("__", 1)
    evaluator_cls = load_evaluator(family, name)
    defs = get_evaluator_definitions(evaluator_cls)
    cases = json.loads((CORPUS / f"{stem}.json").read_text(encoding="utf-8"))
    out = []
    for case in cases:
        entry = defs.entry_type.model_validate(case["entry"])
        settings = defs.settings_type.model_validate(case.get("settings") or {})
        env = case.get("env") or {}
        server.begin(case.get("script") or {})
        evaluator = evaluator_cls(settings=settings, env=tenant_env(server.url, env))
        result = evaluator._evaluate_entry(entry, retries=1)
        out.append(
            {
                "name": case["name"],
                "settings": case.get("settings") or {},
                "env": env,
                "entry": case["entry"],
                "result": wire(result),
                "calls": server.take(),
            }
        )
    (FIXTURES / f"{stem}.json").write_text(
        json.dumps(out, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return len(out)


def main() -> None:
    # A cached dspy answer would be a call the recording never saw.
    dspy.configure_cache(enable_disk_cache=False, enable_memory_cache=False)
    only = sys.argv[1:]
    server = FakeLLM().start()
    try:
        for stem in LLM_EVALUATORS:
            if only and stem not in only:
                continue
            print(f"{stem}: {record(stem, server)} cases")
    finally:
        server.stop()


if __name__ == "__main__":
    main()
