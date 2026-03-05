import importlib
import importlib.metadata
import math
import os
import pkgutil
import re
import textwrap
from typing import Optional, Type, get_args

from langevals_core.base_evaluator import (
    BaseEvaluator,
    EvaluationResult,
    EvaluatorEntry,
)
from pydantic import BaseModel


def load_evaluator_packages():
    evaluators = {}
    for distribution in importlib.metadata.distributions():
        normalized_name = distribution.metadata["Name"].replace("-", "_")
        if normalized_name == "langevals_core":
            continue
        if normalized_name.startswith("langevals_"):
            try:
                evaluators[normalized_name] = importlib.import_module(normalized_name)
            except ImportError:
                pass
    return evaluators


def get_evaluator_classes(evaluator_package):
    evaluator_classes: list[BaseEvaluator] = []
    package_path = evaluator_package.__path__
    for _, module_name, _ in pkgutil.walk_packages(package_path):
        print(f"Loading {evaluator_package.__name__}.{module_name}")
        module = importlib.import_module(f"{evaluator_package.__name__}.{module_name}")
        for name, cls in module.__dict__.items():
            if (
                isinstance(cls, type)
                and issubclass(cls, BaseEvaluator)
                and cls is not BaseEvaluator
            ):
                evaluator_classes.append(cls)  # type: ignore

    return evaluator_classes


class EvaluatorDefinitions(BaseModel):
    module_name: str
    evaluator_name: str
    entry_type: Type[EvaluatorEntry]
    settings_type: Type[BaseModel]
    result_type: Type[EvaluationResult]
    name: str
    description: str
    docs_url: Optional[str]
    env_vars: list[str]
    is_guardrail: bool
    category: str


def get_evaluator_definitions(evaluator_cls: BaseEvaluator):
    fields = evaluator_cls.model_fields

    settings_type = fields["settings"].annotation
    entry_type = get_args(fields["entry"].annotation)[0]
    result_type = get_args(fields["result"].annotation)[0]

    namespaces = evaluator_cls.__module__.split(".", 1)
    if len(namespaces) == 2:
        module_name, evaluator_name = namespaces
        module_name = module_name.split("langevals_")[1]
    else:
        module_name = ""
        evaluator_name = evaluator_cls.__class__.__name__
        # CamelCase to snake_case
        evaluator_name = re.sub(r"(?<!^)(?=[A-Z])", "_", evaluator_name).lower()

    if getattr(evaluator_cls, "name", None) is None:
        raise ValueError(f"Missing name attribute in {evaluator_cls}")

    name = evaluator_cls.name
    docs_url = evaluator_cls.docs_url
    description = textwrap.dedent(evaluator_cls.__doc__ or "")
    docs_url = evaluator_cls.docs_url
    env_vars = evaluator_cls.env_vars
    is_guardrail = evaluator_cls.is_guardrail
    category = evaluator_cls.category

    return EvaluatorDefinitions(
        module_name=module_name,
        evaluator_name=evaluator_name,
        entry_type=entry_type,
        settings_type=settings_type,  # type: ignore
        result_type=result_type,
        name=name,
        description=description,
        docs_url=docs_url,
        env_vars=env_vars,
        is_guardrail=is_guardrail,
        category=category,
    )


def get_cpu_count():
    cpu_count = os.getenv("CPU_COUNT", None)
    if cpu_count is not None:
        return int(cpu_count)
    try:
        # Kubernetes
        with open("/sys/fs/cgroup/cpu/cpu.shares") as f:
            cpu_shares = int(f.read().strip())
        return max(1, math.ceil(cpu_shares / 1024))
    except FileNotFoundError:
        try:
            # Local for UNIX
            return len(os.sched_getaffinity(0))
        except AttributeError:
            # Local fallback
            return os.cpu_count() or 4
