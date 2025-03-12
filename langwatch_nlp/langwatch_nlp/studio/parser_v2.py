from typing import Tuple
from langwatch_nlp.studio.types.dsl import Node, Workflow
from langwatch_nlp.studio.dspy.workflow_module import WorkflowModule
from jinja2 import Environment, FileSystemLoader
import re
import dspy

env = Environment(
    loader=FileSystemLoader("./langwatch_nlp/studio/templates"),
    trim_blocks=True,
    lstrip_blocks=True,
)
env.keep_trailing_newline = True


def parse_workflow(workflow: Workflow) -> WorkflowModule:
    template = env.get_template("workflow.py.jinja")
    module = template.render(workflow=workflow, debug_level=1)
    module = re.sub(r"\n{3,}", "\n\n", module)
    print("\n\nmodule", module, "\n\n")
    namespace = {}
    exec(module, namespace)
    WorkflowModule = namespace["WorkflowModule"]
    return WorkflowModule


def parse_component(node: Node, workflow: Workflow) -> Tuple[str, str]:
    match node.type:
        case "signature":
            template = env.get_template("llm.py.jinja")
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

            return f"{node.data.name}", template.render(
                node_id=node.id,
                component=node.data,
                workflow=workflow,
                parameters=parameters,
                prompting_technique=(
                    prompting_technique.value if prompting_technique else None
                ),
                llm_config=llm_config.value if llm_config else None,
                demonstrations=demonstrations.value if demonstrations else None,
            )
        case _:
            return "None", ""


def parse_and_instantiate_component(node: Node, workflow: Workflow) -> dspy.Module:
    class_name, component_code = parse_component(node, workflow)
    return instantiate_component(component_code, class_name)


def instantiate_component(component_code: str, class_name: str) -> dspy.Module:
    namespace = {}
    exec(component_code, namespace)
    return namespace[class_name]
