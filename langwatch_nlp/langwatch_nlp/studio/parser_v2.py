from typing import Tuple, Type, cast, List, Dict, Set
import asyncio
import time
import importlib

from langwatch_nlp.studio.modules.registry import (
    EVALUATORS_FOR_TEMPLATE,
    FIELD_TYPE_TO_DSPY_TYPE,
    PROMPTING_TECHNIQUES_FOR_TEMPLATE,
)
from langwatch_nlp.studio.parser import parse_fields
from langwatch_nlp.studio.types.dsl import Node, Workflow, Edge
from langwatch_nlp.studio.dspy.workflow_module import WorkflowModule
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule
from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.predict_with_metadata import PredictionWithMetadata
from dspy.utils.asyncify import asyncify
from langevals_core.base_evaluator import (
    SingleEvaluationResult,
    EvaluationResultError,
    EvaluationResult,
)
import langwatch
from jinja2 import Environment, FileSystemLoader
import re
import dspy

from langwatch_nlp.studio.utils import transpose_inline_dataset_to_object_list
import isort
import black


def raise_helper(msg):
    raise Exception(msg)


env = Environment(
    loader=FileSystemLoader("./langwatch_nlp/studio/templates"),
    trim_blocks=True,
    lstrip_blocks=True,
)
env.globals["raise"] = raise_helper
env.globals["PROMPTING_TECHNIQUES"] = PROMPTING_TECHNIQUES_FOR_TEMPLATE
env.globals["FIELD_TYPE_TO_DSPY_TYPE"] = FIELD_TYPE_TO_DSPY_TYPE
env.globals["EVALUATORS"] = EVALUATORS_FOR_TEMPLATE
env.globals["parse_fields"] = parse_fields
env.keep_trailing_newline = True


def render_template(template_name: str, format=False, **kwargs) -> str:
    template = env.get_template(template_name)
    code = template.render(**kwargs)
    code = re.sub(r"\n{4,}", "\n\n", code)
    try:
        code = isort.code(code, float_to_top=True)
        if format:
            code = black.format_str(code, mode=black.Mode())
    except Exception as e:
        raise Exception(
            f"Invalid syntax on the generated code: {e}\n\n{code}\n\nTemplate: {template_name}"
        )
    return code


def parse_workflow(
    workflow: Workflow, format=False, debug_level=0, until_node_id=None
) -> Tuple[str, str]:
    # Find all reachable nodes from entry
    nodes = find_reachable_nodes(
        workflow.nodes, workflow.edges, until_node_id=until_node_id
    )

    node_templates = {
        node.id: parse_component(node, workflow, format) for node in nodes
    }

    module = render_template(
        "workflow.py.jinja",
        format=format,
        workflow=workflow,
        debug_level=debug_level,
        node_templates=node_templates,
        nodes=nodes,
    )

    return "WorkflowModule", module


def parse_and_instantiate_workflow(
    workflow: Workflow, format=False
) -> Type[WorkflowModule]:
    class_name, module = parse_workflow(workflow, format)
    Module = get_component_class(class_name, module)
    # TODO: make this an interface
    return cast(Type[WorkflowModule], Module)


def parse_component(
    node: Node, workflow: Workflow, format=False, debug_level=0
) -> Tuple[str, str]:
    match node.type:
        case "signature":
            parameters = {}
            if node.data.parameters:
                for param in node.data.parameters:
                    if param.value is not None:
                        parameters[param.identifier] = param.value

            prompting_technique = next(
                (
                    p
                    for p in node.data.parameters or []
                    if p.identifier == "prompting_technique"
                ),
                None,
            )
            llm_config = next(
                (p for p in node.data.parameters or [] if p.identifier == "llm"),
                None,
            )
            demonstrations = next(
                (
                    p
                    for p in node.data.parameters or []
                    if p.identifier == "demonstrations"
                ),
                None,
            )
            demonstrations_dict = (
                transpose_inline_dataset_to_object_list(demonstrations.value.inline)
                if demonstrations
                and demonstrations.value
                and demonstrations.value.inline
                else None
            )

            return f"{node.data.name}", render_template(
                "llm.py.jinja",
                format=format,
                debug_level=debug_level,
                node_id=node.id,
                component=node.data,
                workflow=workflow,
                parameters=parameters,
                prompting_technique=(
                    prompting_technique.value if prompting_technique else None
                ),
                llm_config=llm_config.value if llm_config else None,
                demonstrations=demonstrations_dict,
                # PROMPTING_TECHNIQUES=PROMPTING_TECHNIQUES_FOR_TEMPLATE,
                # FIELD_TYPE_TO_DSPY_TYPE=FIELD_TYPE_TO_DSPY_TYPE,
            )
        case "prompting_technique":
            raise NotImplementedError("Prompting techniques cannot be parsed directly")
        case "evaluator":
            # Evaluators are handled directly in the workflow template
            return "None", ""
        case _:
            # TODO: throw error for unknown node type
            return "None", ""


def get_component_class(component_code: str, class_name: str) -> Type[dspy.Module]:
    namespace = {}
    exec(component_code, namespace)
    return namespace[class_name]


def find_reachable_nodes(
    nodes: List[Node], edges: List[Edge], until_node_id=None
) -> List[Node]:
    # First, check for cycles in the workflow
    detect_cycles(nodes, edges)

    # Build dependency graph and node lookup
    dependency_graph: Dict[str, List[str]] = {node.id: [] for node in nodes}
    node_lookup: Dict[str, Node] = {node.id: node for node in nodes}

    for edge in edges:
        dependency_graph[edge.target].append(edge.source)

    # BFS to find all reachable nodes
    reachable_node_ids: Set[str] = {"entry"}
    queue = ["entry"]
    visited: Set[str] = set()

    while queue:
        current = queue.pop(0)
        if current not in visited:
            visited.add(current)
            reachable_node_ids.add(current)

            # Find all nodes that have this node as a dependency
            new_queue_items = []
            for node_id, deps in dependency_graph.items():
                if current in deps and node_id not in visited and node_id not in queue:
                    new_queue_items.append(node_id)

                # If we've reached the specified until_node_id, stop the traversal
                if until_node_id is not None and until_node_id in new_queue_items:
                    queue.append(until_node_id)
                    visited.add(current)
                    reachable_node_ids.add(current)
                    break

            queue.extend(new_queue_items)

    # Convert IDs to Node objects
    reachable_nodes = [
        node_lookup[node_id] for node_id in reachable_node_ids if node_id in node_lookup
    ]

    return reachable_nodes


def detect_cycles(nodes: List[Node], edges: List[Edge]) -> None:
    """
    Detects cyclic dependencies in the workflow graph.
    Raises an exception with details if a cycle is found.

    Uses Depth-First Search (DFS) with tracking of visited and in-progress nodes.
    """
    # Build forward adjacency list (node_id -> nodes it points to)
    graph: Dict[str, List[str]] = {"entry": []}
    for node in nodes:
        graph[node.id] = []

    for edge in edges:
        source, target = edge.source, edge.target
        if source not in graph:
            graph[source] = []
        graph[source].append(target)

    # For cycle detection
    visited: Dict[str, bool] = {node_id: False for node_id in graph.keys()}
    in_progress: Dict[str, bool] = {node_id: False for node_id in graph.keys()}
    # Track the path for better error reporting
    path: Dict[str, List[str]] = {}

    def dfs_check_cycle(node_id: str) -> Tuple[bool, List[str]]:
        visited[node_id] = True
        in_progress[node_id] = True

        if node_id not in path:
            path[node_id] = [node_id]

        for neighbor in graph.get(node_id, []):
            if not visited.get(neighbor, False):
                path[neighbor] = path[node_id] + [neighbor]
                has_cycle, cycle_path = dfs_check_cycle(neighbor)
                if has_cycle:
                    return True, cycle_path
            elif in_progress.get(neighbor, False):
                # Cycle detected - get the path from current node to the repeated neighbor
                cycle_path = path[node_id] + [neighbor]
                # Find the start of the cycle
                start_idx = cycle_path.index(neighbor)
                return True, cycle_path[start_idx:]

        in_progress[node_id] = False
        return False, []

    # Start DFS from entry node
    has_cycle, cycle_path = dfs_check_cycle("entry")
    if has_cycle:
        raise Exception(f"Cyclic dependency detected: {' -> '.join(cycle_path)}")
