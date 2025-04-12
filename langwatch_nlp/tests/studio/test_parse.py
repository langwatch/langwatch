import copy
import dspy
from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.parser_v2 import parse_component, materialized_component_class
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.types.dsl import (
    Code,
    CodeNode,
    DatasetInline,
    Field,
    FieldType,
    LLMConfig,
    NodeDataset,
    NodeRef,
    PromptingTechnique,
    PromptingTechniqueNode,
    Signature,
    SignatureNode,
    Workflow,
    WorkflowState,
)

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

llm_field = Field(
    identifier="llm",
    type=FieldType.llm,
    optional=None,
    value=LLMConfig(
        model="gpt-4o-mini",
        temperature=0.0,
        max_tokens=100,
    ),
    desc=None,
)

inputs = [
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
]

outputs = [
    Field(
        identifier="answer",
        type=FieldType.str,
        optional=None,
        value=None,
        desc=None,
        prefix=None,
        hidden=None,
    ),
]


def test_parse_signature():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[llm_field],
            inputs=inputs,
            outputs=outputs,
            execution_state=None,
        ),
        type="signature",
    )

    code, class_name, _ = parse_component(node, basic_workflow)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, LLMNode)


def test_parse_signature_empty_inputs_and_outputs():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[llm_field],
            inputs=[],
            outputs=[],
            execution_state=None,
        ),
        type="signature",
    )

    code, class_name, _ = parse_component(node, basic_workflow, format=True)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, LLMNode)


def test_parse_signature_with_prompting_technique():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[
                llm_field,
                Field(
                    identifier="prompting_technique",
                    type=FieldType.prompting_technique,
                    optional=None,
                    value=NodeRef(ref="chain_of_thought"),
                    desc=None,
                ),
            ],
            inputs=inputs,
            outputs=outputs,
            execution_state=None,
        ),
        type="signature",
    )

    prompting_technique = PromptingTechniqueNode(
        id="chain_of_thought",
        data=PromptingTechnique(
            name="ChainOfThought", cls="ChainOfThought", parameters=[]
        ),
    )

    workflow = copy.deepcopy(basic_workflow)
    workflow.nodes.append(prompting_technique)

    code, class_name, _ = parse_component(node, workflow, format=True)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, LLMNode)


def test_parse_signature_with_demonstrations():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[
                llm_field,
                Field(
                    identifier="demonstrations",
                    type=FieldType.dataset,
                    optional=None,
                    value=NodeDataset(
                        name="Demonstrations",
                        inline=DatasetInline(
                            records={
                                "question": [
                                    "What is the capital of France?",
                                    "What is the capital of Germany?",
                                ],
                                "answer": ["Paris", "Berlin"],
                            },
                            columnTypes=[
                                DatasetColumn(
                                    name="question",
                                    type=DatasetColumnType.string,
                                ),
                                DatasetColumn(
                                    name="answer",
                                    type=DatasetColumnType.string,
                                ),
                            ],
                        ),
                    ),
                ),
            ],
            inputs=inputs,
            outputs=outputs,
            execution_state=None,
        ),
        type="signature",
    )

    code, class_name, _ = parse_component(node, basic_workflow, format=True)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, LLMNode)


def test_parse_signature_with_default_workflow_llm():
    node = SignatureNode(
        id="generate_answer",
        data=Signature(
            name="GenerateAnswer",
            cls=None,
            parameters=[],
            inputs=inputs,
            outputs=outputs,
            execution_state=None,
        ),
        type="signature",
    )
    workflow = copy.deepcopy(basic_workflow)
    workflow.default_llm = LLMConfig(model="gpt-4o", temperature=0.0, max_tokens=100)

    code, class_name, _ = parse_component(node, workflow)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, LLMNode)


def test_parse_code():
    node = CodeNode(
        id="generate_answer",
        data=Code(
            name="GenerateAnswer",
            cls="GenerateAnswer",
            parameters=[
                Field(
                    identifier="code",
                    type=FieldType.str,
                    optional=None,
                    value="""
import dspy

class GenerateAnswer(dspy.Module):
    def forward(self, **kwargs):
        return "Hello, world!"
                """,
                    desc=None,
                ),
            ],
        ),
    )

    code, class_name, _ = parse_component(node, basic_workflow, format=True)
    with materialized_component_class(code, class_name) as Module:
        assert issubclass(Module, dspy.Module)
