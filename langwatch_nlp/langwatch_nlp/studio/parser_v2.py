from langwatch_nlp.studio.types.dsl import Workflow
from langwatch_nlp.studio.dspy.workflow_module import WorkflowModule
from jinja2 import Environment, FileSystemLoader
import re

env = Environment(
    loader=FileSystemLoader("./langwatch_nlp/studio/templates"),
    trim_blocks=True,
    lstrip_blocks=True
)
env.keep_trailing_newline = True


def parse_workflow(workflow: Workflow) -> WorkflowModule:
    template = env.get_template("workflow.py.jinja")
    module = template.render(workflow=workflow, debug_level=1)
    module = re.sub(r'\n{3,}', '\n\n', module)
    print("\n\nmodule", module, "\n\n")
    namespace = {}
    exec(module, namespace)
    WorkflowModule = namespace["WorkflowModule"]
    return WorkflowModule
