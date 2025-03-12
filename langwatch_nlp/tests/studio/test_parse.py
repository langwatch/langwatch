from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.parser_v2 import parse_component, instantiate_component
from langwatch_nlp.studio.types.dsl import (
    Field,
    FieldType,
    LLMConfig,
    Signature,
    SignatureNode,
    Workflow,
    WorkflowState,
)
import dspy


basic_workflow = Workflow(
    workflow_id="basic",
    api_key="",
    spec_version="1.3",
    name="Basic",
    icon="🧩",
    description="Basic workflow",
    version="1.3",
    nodes=[],
    edges=[],
    state=WorkflowState(execution=None, evaluation=None),
)


def test_parse_signature_with_custom_llm():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[
                Field(
                    identifier="llm",
                    type=FieldType.llm,
                    optional=None,
                    value=LLMConfig(
                        model="gpt-4o-mini",
                        temperature=0.0,
                        max_tokens=100,
                    ),
                    desc=None,
                ),
            ],
            inputs=[
                Field(
                    identifier="question",
                    type=FieldType.str,
                    optional=None,
                    value=None,
                    desc=None,
                    prefix=None,
                    hidden=None,
                ),
                Field(
                    identifier="query",
                    type=FieldType.str,
                    optional=None,
                    value=None,
                    desc=None,
                    prefix=None,
                    hidden=None,
                ),
            ],
            outputs=[
                Field(
                    identifier="answer",
                    type=FieldType.str,
                    optional=None,
                    value=None,
                    desc=None,
                    prefix=None,
                    hidden=None,
                ),
            ],
            execution_state=None,
        ),
        type="signature",
    )

    class_name, code = parse_component(node, basic_workflow)
    component = instantiate_component(code, class_name)

    assert isinstance(component, LLMNode)


# TODO: test with workflow llm
# TODO: test with prompting technique
# TODO: test with demonstrations
