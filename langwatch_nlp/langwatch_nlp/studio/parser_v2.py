from typing import Tuple, Type, cast
from langwatch_nlp.studio.modules.registry import (
    EVALUATORS_FOR_TEMPLATE,
    FIELD_TYPE_TO_DSPY_TYPE,
    PROMPTING_TECHNIQUES_FOR_TEMPLATE,
)
from langwatch_nlp.studio.parser import parse_fields
from langwatch_nlp.studio.types.dsl import Node, Workflow
from langwatch_nlp.studio.dspy.workflow_module import WorkflowModule
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


def parse_workflow(workflow: Workflow, format=False) -> Tuple[str, str]:
    node_templates = {
        node.id: parse_component(node, workflow, format) for node in workflow.nodes
    }
    module = render_template(
        "workflow.py.jinja",
        format=format,
        workflow=workflow,
        debug_level=1,
        node_templates=node_templates,
    )

    return "WorkflowModule", module


def parse_and_instantiate_workflow(
    workflow: Workflow, format=False
) -> Type[WorkflowModule]:
    class_name, module = parse_workflow(workflow, format)
    Module = get_component_class(class_name, module)
    # TODO: make this an interface
    return cast(Type[WorkflowModule], Module)


def parse_component(node: Node, workflow: Workflow, format=False) -> Tuple[str, str]:
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
                debug_level=1,
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
