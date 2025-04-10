import copy
from typing import Tuple, Type, cast, List, Dict, Set
import asyncio
import time
import importlib

from langwatch_nlp.studio.field_parser import parse_fields
from langwatch_nlp.studio.modules.registry import (
    EVALUATORS_FOR_TEMPLATE,
    FIELD_TYPE_TO_DSPY_TYPE,
    PROMPTING_TECHNIQUES_FOR_TEMPLATE,
)
from langwatch_nlp.studio.types.dsl import Field, Node, Workflow, Edge
from langwatch_nlp.studio.dspy.workflow_module import WorkflowModule
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule
from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationResultWithMetadata,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.dspy.predict_with_metadata import PredictionWithMetadata
from langevals_core.base_evaluator import (
    SingleEvaluationResult,
    EvaluationResultError,
    EvaluationResult,
)
import langwatch
from jinja2 import Environment, FileSystemLoader
import re
import dspy

from langwatch_nlp.studio.utils import (
    normalize_name_to_class_name,
    transpose_inline_dataset_to_object_list,
)
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
    workflow: Workflow,
    format=False,
    debug_level=0,
    until_node_id=None,
    handle_errors=False,
    do_not_trace=False,
) -> Tuple[str, str]:
    # Find all reachable nodes from entry
    nodes = (
        find_path_until_node(until_node_id, workflow.nodes, workflow.edges)
        if until_node_id
        else find_reachable_nodes(workflow.nodes, workflow.edges)
    )
    for node in nodes:
        node.data.name = normalize_name_to_class_name(node.data.name or "")

    node_templates = {
        node.id: parse_component(node, workflow, format) for node in nodes
    }

    inputs = workflow_inputs(workflow)
    use_kwargs = any(re.search(r"[^a-zA-Z0-9]", field.identifier) for field in inputs)

    module = render_template(
        "workflow.py.jinja",
        format=format,
        workflow=workflow,
        debug_level=debug_level,
        node_templates=node_templates,
        nodes=nodes,
        inputs=inputs,
        use_kwargs=use_kwargs,
        handle_errors=handle_errors,
        do_not_trace=do_not_trace,
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
    node = copy.deepcopy(node)
    node.data.name = normalize_name_to_class_name(node.data.name or "")

    match node.type:
        case "signature":
            parameters = parse_fields(node.data.parameters or [], autoparse=True)

            prompting_technique = parameters.get("prompting_technique")
            llm_config = parameters.get("llm")
            demonstrations = parameters.get("demonstrations")
            demonstrations_dict = (
                transpose_inline_dataset_to_object_list(demonstrations.inline)
                if demonstrations and demonstrations.inline
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
                prompting_technique=prompting_technique,
                llm_config=llm_config,
                demonstrations=demonstrations_dict,
            )
        case "prompting_technique":
            raise NotImplementedError("Prompting techniques cannot be parsed directly")
        case "evaluator":
            # Evaluators are handled directly in the workflow template
            return "None", ""
        case "code":
            code = next(
                (p for p in node.data.parameters or [] if p.identifier == "code"),
                None,
            )
            code = code.value if code else None
            if not code:
                raise Exception(
                    f"Code node has no source content for component {node.data.name}"
                )

            pattern = r"class (.*?)\(dspy\.Module\):"
            match = re.search(pattern, code)
            if not match:
                raise ValueError(
                    f"Could not find a class that inherits from dspy.Module for component {node.data.name}"
                )
            class_name = match.group(1)

            return class_name, code
        case "retriever":
            raise NotImplementedError("Not implemented yet")
        case "custom":
            raise NotImplementedError("Not implemented yet")
        case _:
            # TODO: throw error for unknown node type
            return "None", ""


def get_component_class(component_code: str, class_name: str) -> Type[dspy.Module]:
    namespace = {}
    exec(component_code, namespace)
    return namespace[class_name]


def find_path_until_node(
    until_node_id: str, nodes: List[Node], edges: List[Edge]
) -> List[Node]:
    # First, check for cycles in the workflow
    detect_cycles(nodes, edges)

    # If the target node is not found, return an empty list
    if until_node_id not in [node.id for node in nodes] and until_node_id != "entry":
        raise ValueError(f"Node with ID '{until_node_id}' not found in the workflow")

    # Handle special case if until_node_id is "entry"
    if until_node_id == "entry":
        entry_node = next((node for node in nodes if node.id == "entry"), None)
        return [entry_node] if entry_node else []

    # Build reverse dependency graph: node_id -> nodes it depends on
    reverse_graph: Dict[str, List[str]] = {"entry": []}
    for node in nodes:
        reverse_graph[node.id] = []

    for edge in edges:
        source, target = edge.source, edge.target
        # In the reverse graph, target depends on source
        reverse_graph[target].append(source)

    # Create a lookup for nodes by their id
    node_lookup = {node.id: node for node in nodes}

    # Trace back from the target node to the entry
    visited = set()
    required_nodes = set()

    def trace_dependencies(node_id: str):
        if node_id in visited:
            return

        visited.add(node_id)
        required_nodes.add(node_id)

        for dependency in reverse_graph.get(node_id, []):
            trace_dependencies(dependency)

    # Start tracing from the target node
    trace_dependencies(until_node_id)

    # Get all nodes in the correct order (using topological sort)
    result_nodes = []

    # A simplified topological sort since we already know the graph is acyclic
    def dfs_topo_sort(node_id: str, visited_topo: Set[str]):
        if node_id in visited_topo or node_id not in required_nodes:
            return

        visited_topo.add(node_id)

        # Visit all dependencies first
        for dependency in reverse_graph.get(node_id, []):
            dfs_topo_sort(dependency, visited_topo)

        # Add the node to result if it's in our required set
        if node_id in node_lookup:
            result_nodes.append(node_lookup[node_id])
        elif node_id == "entry":
            entry_node = next((node for node in nodes if node.id == "entry"), None)
            if entry_node:
                result_nodes.append(entry_node)

    # Start DFS from the target node to get a topological ordering
    dfs_topo_sort(until_node_id, set())

    # Reverse to get the correct order (from entry to target)
    return list(reversed(result_nodes))


def find_reachable_nodes(nodes: List[Node], edges: List[Edge]) -> List[Node]:
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


# Get all edges with source "entry"
def workflow_inputs(workflow: Workflow) -> List[Field]:
    entry_node = next((node for node in workflow.nodes if node.type == "entry"), None)
    if not entry_node:
        raise Exception("Entry node not found in workflow")

    return [field for field in (entry_node.data.outputs or [])]
