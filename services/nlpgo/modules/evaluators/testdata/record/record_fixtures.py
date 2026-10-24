"""Record the langevals wire result for every corpus case, in-process.

Run: uv run --project services/langevals python \
  services/nlpgo/modules/evaluators/testdata/record/record_fixtures.py
Only evaluators that make no model, embedding or network call are recorded.
"""

import importlib
import json
import os
import sys
from pathlib import Path

# No provider keys, no network: keep litellm/ragas from phoning home.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ["RAGAS_DO_NOT_TRACK"] = "true"
os.environ["DISABLE_EVALUATORS_PRELOAD"] = "1"
for key in list(os.environ):
    if key.endswith("_API_KEY") or key.endswith("_API_BASE"):
        del os.environ[key]

from langevals_core.base_evaluator import BaseEvaluator  # noqa: E402
from langevals.utils import get_evaluator_definitions  # noqa: E402

HERE = Path(__file__).resolve().parent
CORPUS = HERE / "corpus"
FIXTURES = HERE.parent / "fixtures"
# Corpus stems recorded by another evaluator than the stem names.
EVALUATOR_OF_STEM = {"presidio__pii_detection_ner": "presidio__pii_detection"}


def load_evaluator(family: str, name: str):
    module_name = f"langevals_{family}.{name}"
    module = importlib.import_module(module_name)
    for cls in vars(module).values():
        if (
            isinstance(cls, type)
            and issubclass(cls, BaseEvaluator)
            and cls is not BaseEvaluator
            and cls.__module__ == module_name
        ):
            return cls
    raise RuntimeError(f"no evaluator class in {module_name}")


def wire(result) -> dict:
    """Serialise the way FastAPI does for the server response."""
    out = result.model_dump(mode="json")
    if out.get("status") == "error":
        out["traceback"] = []  # machine-specific paths; not part of the contract
    return out


def record(path: Path) -> int:
    family, name = EVALUATOR_OF_STEM.get(path.stem, path.stem).split("__", 1)
    evaluator_cls = load_evaluator(family, name)
    defs = get_evaluator_definitions(evaluator_cls)
    cases = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for case in cases:
        entry = defs.entry_type.model_validate(case["entry"])
        settings = defs.settings_type.model_validate(case.get("settings") or {})
        evaluator = evaluator_cls(settings=settings)
        result = evaluator._evaluate_entry(entry, retries=1)
        out.append(
            {
                "name": case["name"],
                "settings": case.get("settings") or {},
                "entry": case["entry"],
                "result": wire(result),
            }
        )
    FIXTURES.mkdir(exist_ok=True)
    (FIXTURES / path.name).write_text(
        json.dumps(out, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return len(out)


def main() -> None:
    only = sys.argv[1:]
    for path in sorted(CORPUS.glob("*.json")):
        if only and path.stem not in only:
            continue
        print(f"{path.stem}: {record(path)} cases")


if __name__ == "__main__":
    main()
