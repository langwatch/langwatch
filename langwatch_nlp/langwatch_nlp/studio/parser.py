from contextlib import contextmanager, redirect_stdout
import copy
import io
import json
import os
import shutil
import sys
import tempfile
from importlib import reload
from typing import Any, Generator, Tuple, Type, cast, List, Dict, Set

import langwatch

from langwatch_nlp.studio.dspy.langwatch_workflow_module import LangWatchWorkflowModule
from langwatch_nlp.studio.field_parser import parse_fields
from langwatch_nlp.studio.modules.registry import (
    EVALUATORS_FOR_TEMPLATE,
    FIELD_TYPE_TO_DSPY_TYPE,
    PROMPTING_TECHNIQUES_FOR_TEMPLATE,
    RETRIEVERS_FOR_TEMPLATE,
)
from langwatch_nlp.studio.types.dsl import Field, Node, Workflow, Edge
from jinja2 import Environment, FileSystemLoader
import re
import dspy

from langwatch_nlp.studio.utils import (
    SerializableWithStringFallback,
    get_corrected_llm_params,
    build_secrets_preamble,
    normalize_name_to_class_name,
    normalize_to_variable_name,
    snake_case_to_pascal_case,
    transpose_inline_dataset_to_object_list,
    reserved_keywords,
)
import isort
import black
import datamodel_code_generator


def raise_helper(msg):
    raise Exception(msg)


env = Environment(
    loader=FileSystemLoader("./langwatch_nlp/studio/templates"),
    trim_blocks=True,
    lstrip_blocks=True,
)
env.globals["os"] = os
env.globals["raise"] = raise_helper
env.globals["PROMPTING_TECHNIQUES"] = PROMPTING_TECHNIQUES_FOR_TEMPLATE
env.globals["FIELD_TYPE_TO_DSPY_TYPE"] = FIELD_TYPE_TO_DSPY_TYPE
env.globals["parse_fields"] = parse_fields
env.keep_trailing_newline = True


def fix_surrogate_pairs(text: str) -> str:
    """
    Fix surrogate pairs that may have been incorrectly encoded as separate escape sequences.
    This handles cases like \\ud83d\\ude00 -> 😀 without affecting other escape sequences like \\n.
    """

    def replace_surrogate_pair(match: re.Match[str]) -> str:
        try:
            escaped = match.group(0)
            decoded = escaped.encode("utf-8").decode("unicode_escape")
            return decoded.encode("utf-16", "surrogatepass").decode("utf-16")
        except Exception:
            return match.group(0)

    # Match pairs of unicode escape sequences that look like surrogate pairs
    # High surrogate: \uD800-\uDBFF, Low surrogate: \uDC00-\uDFFF
    surrogate_pair_pattern = r"\\u[dD][89aAbB][0-9a-fA-F]{2}\\u[dD][cCdDeEfF][0-9a-fA-F]{2}"
    return re.sub(surrogate_pair_pattern, replace_surrogate_pair, text)


def render_template(template_name: str, format=False, **kwargs) -> str:
    template = env.get_template(template_name)
    code = template.render(**kwargs)
    # Fix emoji surrogate pair encoding issues without affecting other escape sequences
    code = fix_surrogate_pairs(code)
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
) -> Tuple[str, str, List[Field]]:
    workflow = normalized_workflow(workflow)

    # Find all reachable nodes from entry
    nodes = (
        find_path_until_node(until_node_id, workflow.nodes, workflow.edges)
        if until_node_id
        else find_reachable_nodes(workflow.nodes, workflow.edges)
    )
    for node in nodes:
        node.data.name = normalize_name_to_class_name(node.data.name or "")

    node_templates = {
        node.id: parse_component(node, workflow, format)
        for node in nodes
        if node.type not in ("entry", "end")
    }

    inputs = workflow_inputs(workflow)
    use_kwargs = any(
        re.search(r"[^a-zA-Z0-9]", field.identifier)
        or field.identifier in reserved_keywords
        for field in inputs
    )

    corrected_default_llm_params = (
        get_corrected_llm_params(workflow.default_llm)
        if workflow.default_llm
        else None
    )

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
        corrected_default_llm_params=corrected_default_llm_params,
    )

    return "WorkflowModule", module, inputs


@contextmanager
def parsed_and_materialized_workflow_class(
    workflow: Workflow,
    format=False,
    debug_level=0,
    until_node_id=None,
    handle_errors=False,
    do_not_trace=False,
) -> Generator[Tuple[Type[LangWatchWorkflowModule], List[Field]], None, None]:
    class_name, code, inputs = parse_workflow(
        workflow, format, debug_level, until_node_id, handle_errors, do_not_trace
    )
    code = build_secrets_preamble(workflow.secrets) + code
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        yield cast(Type[LangWatchWorkflowModule], Module), inputs


_SIGNATURE_FIELD_TYPE_SPECIAL_CASES = {"json_schema"}


def _assert_signature_field_types_are_mapped(node: Node) -> None:
    """
    Surface unmapped signature input/output types as a structured error so the user sees
    which field broke instead of a bare Jinja `UndefinedError('dict object' has no attribute
    'X')`. See langwatch/langwatch#3415 AC 5.
    """
    for collection, kind in (
        (node.data.inputs or [], "input"),
        (node.data.outputs or [], "output"),
    ):
        for field in collection:
            raw_type = getattr(field.type, "value", field.type)
            if raw_type in _SIGNATURE_FIELD_TYPE_SPECIAL_CASES:
                continue
            if field.type in FIELD_TYPE_TO_DSPY_TYPE:
                continue
            raise ValueError(
                f"Signature node '{node.id}' {kind} field '{field.identifier}' has type "
                f"'{raw_type}' which is not present in FIELD_TYPE_TO_DSPY_TYPE. Add a mapping "
                f"in langwatch_nlp/studio/modules/registry.py or extend llm.py.jinja with a "
                f"special case."
            )


# Class-declaration regex: captures the name of any class declaration,
# whether or not it inherits from a base. The base list (parenthesized)
# is matched via `[^)]*` — a negated character class which includes
# newlines — so a multi-line base declaration like
#     class X(
#         dspy.Module,
#         SomeMixin,
#     ):
# resolves correctly. Used by _resolve_code_class_name below.
_CLASS_DECL_RE = re.compile(r"class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:")
# Legacy dspy.Module subclass shape — kept as a fast first-pass match
# since it covers nearly all in-prod customer code today. Intentionally
# strict: matches only `class X(dspy.Module):` (no other bases). The
# `class X(dspy.Module, SomeMixin):` shape is rare in practice and falls
# through to `_CLASS_DECL_RE` cleanly, returning the same class.
_DSPY_MODULE_SUBCLASS_RE = re.compile(r"class\s+([A-Za-z_]\w*)\s*\(\s*dspy\.Module\s*\)\s*:")


def _resolve_code_class_name(
    code: str, node_name: str | None, kind: str = "component"
) -> str:
    """Pick the user-defined class to instantiate from ``code``.

    Resolution order matches the **class-based** shapes the Go runtime
    accepts (services/nlpgo/app/engine/blocks/codeblock/runner.py), so
    the same customer code runs identically on FF=on and FF=off:

      1. ``class X(dspy.Module):`` — preferred (legacy default; the
         dspy.Module wrapper provides cost-tracing + tracking).
      2. ``class X:`` matching the node's display name (after
         normalization to a class identifier) — picks the right class
         when the user defines helpers alongside the entry class.
      3. First ``class X:`` declaration in the file.

    The Go runtime ALSO accepts a fourth shape — a top-level ``def
    execute(**inputs)`` callable with no enclosing class — but that
    shape is intentionally NOT supported on the Python side. This
    parser is a class-name extractor (the resolved name is later passed
    to ``getattr(module, class_name)``); a top-level function has no
    class to extract. Source with a top-level ``execute`` and no class
    raises a clear ValueError listing the supported shapes. If parity
    is ever needed, swap the resolver for an importer-then-inspect flow
    similar to the Go runner.

    Method-level shape within the chosen class (``__call__`` vs
    ``forward`` vs neither) is NOT inspected here because the source
    is not yet imported; the chosen class is materialized downstream
    and the caller uses Python's normal instance(...) protocol, which
    dispatches to ``__call__`` if defined and otherwise falls through
    to whatever attribute the legacy dspy path expects. A class with
    neither raises a TypeError at call time — clearer than failing
    here.

    Anchors PR #3483's per-shape contract back-compat for FF=off so
    customers using the new ``class X: def __call__(...)`` template
    don't error before the FF rolls to them.
    """
    match = _DSPY_MODULE_SUBCLASS_RE.search(code)
    if match:
        return match.group(1)

    # Fall back to any class declaration. Prefer one whose name matches
    # the (normalized) node name when there are multiple candidates,
    # so that helpers defined above the entry class don't get picked
    # incorrectly.
    candidates = _CLASS_DECL_RE.findall(code)
    if not candidates:
        raise ValueError(
            f"Could not find a class definition for {kind} {node_name}. "
            f"Supported shapes: dspy.Module subclass, class with __call__, "
            f"or class with forward()."
        )

    if node_name:
        target = normalize_name_to_class_name(node_name)
        for name in candidates:
            if name == target:
                return name
    return candidates[0]


def parse_component(
    node: Node, workflow: Workflow, standalone=False, format=False, debug_level=0
) -> Tuple[str, str, Dict[str, Any]]:
    match node.type:
        case "signature":
            _assert_signature_field_types_are_mapped(node)
            parameters = parse_fields(node.data.parameters or [], autoparse=True)

            prompting_technique = parameters.get("prompting_technique")
            llm_config = parameters.get("llm")
            demonstrations = parameters.get("demonstrations")
            demonstrations_dict = (
                transpose_inline_dataset_to_object_list(demonstrations.inline)
                if demonstrations and demonstrations.inline
                else None
            )

            json_schema_types = generate_pydantic_type_for_json_schema_fields(
                node.data.name or "Anonymous", node.data.outputs or []
            )

            corrected_llm_params = (
                get_corrected_llm_params(llm_config) if llm_config else None
            )

            return (
                render_template(
                    "llm.py.jinja",
                    format=format,
                    debug_level=debug_level,
                    node_id=node.id,
                    component=node.data,
                    workflow=workflow,
                    standalone=standalone,
                    parameters=parameters,
                    prompting_technique=prompting_technique,
                    llm_config=llm_config,
                    corrected_llm_params=corrected_llm_params,
                    demonstrations=demonstrations_dict,
                    json_schema_types=json_schema_types,
                ),
                f"{node.data.name}",
                {},
            )
        case "prompting_technique":
            raise NotImplementedError("Prompting techniques cannot be parsed directly")
        case "evaluator":
            if not node.data.cls:
                raise ValueError(
                    f"Evaluator class not specified for component {node.data.name}"
                )

            if node.data.cls == "LangWatchEvaluator" and not node.data.evaluator:
                raise ValueError(
                    f"Evaluator not specified for LangWatchEvaluator {node.data.name}"
                )

            evaluator = EVALUATORS_FOR_TEMPLATE[node.data.cls]

            return (
                evaluator["import"],
                evaluator["class"],
                (
                    {
                        "api_key": workflow.api_key,
                        "evaluator": node.data.evaluator,
                        "name": node.data.name or "LangWatchEvaluator",
                        "settings": parse_fields(
                            node.data.parameters or [], autoparse=False
                        ),
                    }
                    if node.data.cls == "LangWatchEvaluator"
                    else parse_fields(node.data.parameters or [])
                ),
            )
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

            class_name = _resolve_code_class_name(code, node.data.name)
            try:
                code = black.format_str(code, mode=black.Mode())
            except Exception as e:
                raise ValueError(f"{node.data.name} has invalid code: {e}")

            return code, class_name, {}
        case "retriever":
            if not node.data.cls:
                raise ValueError(
                    f"Retriever class not specified for component {node.data.name}"
                )

            retriever = RETRIEVERS_FOR_TEMPLATE[node.data.cls]
            return (
                retriever["import"]
                + "\nfrom langwatch_nlp.studio.dspy.retrieve import ContextsRetriever",
                f"ContextsRetriever",
                {"rm": retriever["class"], **parse_fields(node.data.parameters or [])},
            )
        case "custom":
            if not node.data.workflow_id:
                raise ValueError("Workflow ID is required for custom nodes")

            params = {
                "api_key": workflow.api_key,
                "endpoint": langwatch.get_endpoint(),
                "workflow_id": node.data.workflow_id,
                "version_id": node.data.version_id,
            }
            if node.data.behave_as == "evaluator":
                return (
                    "from langwatch_nlp.studio.dspy.custom_node import CustomEvaluatorNode",
                    "CustomEvaluatorNode",
                    params,
                )
            else:
                return (
                    "from langwatch_nlp.studio.dspy.custom_node import CustomNode",
                    "CustomNode",
                    params,
                )
        case "http":
            # HTTP config is stored in parameters like other node types
            params = parse_fields(node.data.parameters or [], autoparse=True)

            # Validate required fields
            if not params.get("url"):
                raise ValueError(
                    f"HTTP config 'url' not specified for HTTP node {node.data.name}"
                )

            return (
                "from langwatch_nlp.studio.dspy.http_node import HttpNode",
                "HttpNode",
                params,
            )
        case "agent":
            # Agent nodes delegate to the correct executor based on agent_type
            params = parse_fields(node.data.parameters or [], autoparse=True)
            agent_type = params.pop("agent_type", None)

            match agent_type:
                case "http":
                    if not params.get("url"):
                        raise ValueError(
                            f"HTTP url not specified for agent {node.data.name}"
                        )
                    return (
                        "from langwatch_nlp.studio.dspy.http_node import HttpNode",
                        "HttpNode",
                        params,
                    )
                case "code":
                    code = params.pop("code", None)
                    if not code:
                        raise ValueError(
                            f"Code not specified for agent {node.data.name}"
                        )
                    class_name = _resolve_code_class_name(
                        code, node.data.name, kind="agent"
                    )
                    try:
                        code = black.format_str(code, mode=black.Mode())
                    except Exception as e:
                        raise ValueError(f"Agent {node.data.name} has invalid code: {e}")
                    return code, class_name, {}
                case "workflow":
                    return (
                        "from langwatch_nlp.studio.dspy.custom_node import CustomNode",
                        "CustomNode",
                        {
                            "api_key": workflow.api_key,
                            "endpoint": langwatch.get_endpoint(),
                            **{k: v for k, v in params.items() if k in ("workflow_id", "version_id")},
                        },
                    )
                case _:
                    raise ValueError(
                        f"Unknown agent_type '{agent_type}' for agent {node.data.name}"
                    )
        case "entry":
            raise ValueError("Entry nodes cannot be executed as standalone components")
        case "end":
            raise ValueError("End nodes cannot be executed as standalone components")
        case _:
            raise ValueError(f"Unknown node type: {node.type}")


@contextmanager
def materialized_component_class(
    component_code: str, class_name: str
) -> Generator[Type[Any], None, None]:
    """Materialize a user-defined class from ``component_code`` and yield it.

    Return type is ``Type[Any]`` (was ``Type[dspy.Module]``) because the
    Code node now also accepts plain ``class X: def __call__(...)`` and
    ``class X: def forward(...)`` shapes — the caller uses Python's
    normal ``instance(**inputs)`` invocation, which dispatches to
    ``__call__`` if defined and otherwise hits whatever Module subclass
    the legacy dspy path expects.
    """
    temp_folder = tempfile.mkdtemp()
    sys.path.insert(0, temp_folder)

    # save to file and import
    with open(os.path.join(temp_folder, "generated_component_code.py"), "w") as f:
        f.write(component_code)
    import generated_component_code  # type: ignore

    reload(generated_component_code)

    Module = getattr(generated_component_code, class_name)
    try:
        yield Module
    finally:
        # cleanup
        shutil.rmtree(temp_folder)
        sys.path.remove(temp_folder)


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


def has_llm_node_using_default_llm(workflow: Workflow) -> bool:
    for node in workflow.nodes:
        if node.type != "signature" or not node.data.parameters:
            continue
        llm_param = next((p for p in node.data.parameters if p.type == "llm"), None)
        if not llm_param or not llm_param.value:
            return True
    return False


def normalized_workflow(workflow: Workflow) -> Workflow:
    workflow = copy.deepcopy(workflow)
    for node in workflow.nodes:
        normalized_node(node, mutate=True)

    if not has_llm_node_using_default_llm(workflow):
        workflow.default_llm = None

    for edge in workflow.edges:
        edge.source = normalize_to_variable_name(edge.source)
        [handle, field] = edge.sourceHandle.split(".")
        if edge.source == "entry":
            edge.sourceHandle = f"{handle}.{field}"
        else:
            edge.sourceHandle = f"{handle}.{normalize_to_variable_name(field)}"
        edge.target = normalize_to_variable_name(edge.target)
        [handle, field] = edge.targetHandle.split(".")
        if edge.target == "end":
            edge.targetHandle = field
        else:
            edge.targetHandle = f"{handle}.{normalize_to_variable_name(field)}"

    return workflow


def normalized_node(node: Node, mutate=False) -> Node:
    if not mutate:
        node = copy.deepcopy(node)
    node.id = normalize_to_variable_name(node.id)
    node.data.name = normalize_name_to_class_name(node.data.name or "")
    for field in node.data.parameters or []:
        field.identifier = normalize_to_variable_name(field.identifier)
    for field in node.data.inputs or []:
        field.identifier = normalize_to_variable_name(field.identifier)
    for field in node.data.outputs or []:
        field.identifier = normalize_to_variable_name(field.identifier)
    return node


def generate_pydantic_type_for_json_schema_fields(
    node_name: str,
    fields: List[Field],
) -> Dict[str, Dict[str, str]]:
    pydantic_types = {}
    for field in fields:
        if field.type == "json_schema":
            model_name, output = generate_pydantic_type_for_json_schema_field(
                node_name, field
            )
            pydantic_types[field.identifier] = {
                "model_name": model_name,
                "code": output,
            }
    return pydantic_types


def generate_pydantic_type_for_json_schema_field(
    node_name: str, field: Field
) -> Tuple[str, str]:
    json_schema = field.json_schema or {}

    model_name = normalize_name_to_class_name(
        node_name
        + " "
        + json_schema.get("title", snake_case_to_pascal_case(field.identifier))
    )

    code_buffer = io.StringIO()
    with redirect_stdout(code_buffer):
        datamodel_code_generator.generate(
            json.dumps(json_schema, ensure_ascii=False),
            input_file_type=datamodel_code_generator.InputFileType.JsonSchema,
            class_name=model_name,
        )

    code = code_buffer.getvalue()
    code = re.sub(
        r"# generated by[\s\S]*?from __future__ import annotations", "", code
    ).strip()
    code = re.sub(
        r"class (.*)?\(BaseModel\):\n    __root__: (\S*)?( = .*)?", r"\1 = \2", code
    ).strip()

    return model_name, code
