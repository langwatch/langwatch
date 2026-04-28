import copy
import dspy
from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.parser import parse_component, materialized_component_class
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
import pytest
from langwatch_nlp.studio.types.dsl import (
    Code,
    CodeNode,
    DatasetInline,
    End,
    EndNode,
    Entry,
    EntryNode,
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
    project_id="test-project",
    api_key="",
    spec_version="1.3",
    name="Basic",
    icon="🧩",
    description="Basic workflow",
    version="1.3",
    nodes=[],
    edges=[],
    state=WorkflowState(execution=None, evaluation=None),
    template_adapter="default",
    workflow_type="workflow",
)

llm_field = Field(
    identifier="llm",
    type=FieldType.llm,
    optional=None,
    value=LLMConfig(
        model="gpt-5-mini",
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
    workflow.default_llm = LLMConfig(model="gpt-5-mini", temperature=0.0, max_tokens=100)

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


class TestParseComponentEntryAndEndNodes:
    """Regression tests for entry/end nodes returning 'None' as class name.

    Entry and end nodes are structural workflow nodes that cannot be executed
    as standalone components. Previously, parse_component returned the string
    "None" as the class_name, which caused an AttributeError when
    materialized_component_class tried getattr(module, "None").
    """

    def test_parse_component_raises_for_entry_node(self):
        node = EntryNode(
            id="entry",
            data=Entry(
                name="Entry",
                outputs=[
                    Field(
                        identifier="question",
                        type=FieldType.str,
                    ),
                ],
                train_size=0.5,
                test_size=0.5,
                seed=42,
            ),
        )

        with pytest.raises(ValueError, match="Entry nodes cannot be executed as standalone components"):
            parse_component(node, basic_workflow)

    def test_parse_component_raises_for_end_node(self):
        node = EndNode(
            id="end",
            data=End(
                name="End",
                inputs=[
                    Field(
                        identifier="output",
                        type=FieldType.str,
                    ),
                ],
            ),
        )

        with pytest.raises(ValueError, match="End nodes cannot be executed as standalone components"):
            parse_component(node, basic_workflow)


class TestCodeNodeClassResolutionShapes:
    """Pin back-compat for the FF=off (legacy Python) Code node runtime.

    PR #3483 shipped a new Studio default template (`class Code: def
    __call__(self, ...): ...` — no `dspy.Module` inheritance). The Go
    runtime's runner.py was updated to resolve __call__ / forward /
    dspy.Module / top-level execute, but the Python parser only matched
    `class X(dspy.Module):`. Result: customers still on the legacy
    Python NLP path (FF=off) would hit
        Could not find a class that inherits from dspy.Module for component Code
    when running the new template.

    These tests pin the resolution order in
    `_resolve_code_class_name` so the Python side accepts the same
    shapes the Go side does:
      1. `class X(dspy.Module):` (legacy default — preferred)
      2. `class X:` matching the node's normalized name
      3. First `class X:` declaration (single-class file)
      4. No class → clear error message listing supported shapes.
    """

    def _make_code_node(self, code: str, name: str = "Code") -> CodeNode:
        return CodeNode(
            id="code_node",
            data=Code(
                name=name,
                cls=name,
                parameters=[
                    Field(
                        identifier="code",
                        type=FieldType.str,
                        optional=None,
                        value=code,
                        desc=None,
                    ),
                ],
            ),
        )

    def test_class_with_dunder_call_only_no_dspy_inheritance(self):
        """The new default template — class with __call__, no dspy.Module."""
        node = self._make_code_node(
            """
class Code:
    def __call__(self, input: str):
        return {"output": "Hello world!"}
"""
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        assert class_name == "Code"
        with materialized_component_class(code, class_name) as Module:
            instance = Module()
            assert instance(input="anything") == {"output": "Hello world!"}

    def test_class_with_forward_only_no_dspy_inheritance(self):
        """`forward()` shape without dspy.Module — must also work."""
        node = self._make_code_node(
            """
class Code:
    def forward(self, **kwargs):
        return {"output": kwargs.get("input", "")}
"""
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        assert class_name == "Code"
        with materialized_component_class(code, class_name) as Module:
            instance = Module()
            assert instance.forward(input="x") == {"output": "x"}

    def test_legacy_dspy_module_subclass_still_resolves_first(self):
        """Existing customer code keeps working — back-compat anchor."""
        node = self._make_code_node(
            """
import dspy

class Code(dspy.Module):
    def forward(self, **kwargs):
        return {"output": "legacy"}
""",
            name="Code",
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        assert class_name == "Code"
        with materialized_component_class(code, class_name) as Module:
            assert issubclass(Module, dspy.Module)

    def test_dspy_module_wins_over_helper_classes_above_it(self):
        """When the user defines helpers, the dspy.Module class is picked."""
        node = self._make_code_node(
            """
import dspy

class Helper:
    def __call__(self, x):
        return x

class Code(dspy.Module):
    def forward(self, **kwargs):
        return {"output": "main"}
"""
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        # Despite Helper appearing first, the dspy.Module subclass wins.
        assert class_name == "Code"

    def test_node_name_disambiguates_when_no_dspy_inheritance(self):
        """Multiple bare classes — pick the one matching the node name."""
        node = self._make_code_node(
            """
class Helper:
    pass

class Code:
    def __call__(self, input: str):
        return {"output": "main"}
""",
            name="Code",
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        assert class_name == "Code"

    def test_no_class_in_code_raises_clear_error(self):
        """Helpful error replaces the misleading 'must inherit dspy.Module'.

        Note: the Go runner accepts a top-level ``def execute(...)`` shape;
        the Python parser intentionally does not (it's a class-name
        extractor, not an instance resolver — see _resolve_code_class_name
        docstring). The resulting message must point users at the
        supported shapes so they convert their function into a class.
        """
        node = self._make_code_node(
            """
def execute(input: str):
    return {"output": "no class"}
"""
        )
        with pytest.raises(
            ValueError,
            match=r"Could not find a class definition.*Supported shapes",
        ):
            parse_component(node, basic_workflow)

    def test_class_with_multi_line_base_list_resolves(self):
        """Edge case Sarah flagged in #3543 review.

        The class-declaration regex uses ``[^)]*`` for the base list,
        which (unlike ``.``) matches newlines without re.DOTALL. So a
        multi-line base list — common when the user pulls in mixins —
        still resolves the class name correctly without falling through
        to the no-class branch.
        """
        node = self._make_code_node(
            """
import dspy

class Mixin:
    pass

class Code(
    dspy.Module,
    Mixin,
):
    def forward(self, **kwargs):
        return {"output": "multi-base"}
"""
        )
        code, class_name, _ = parse_component(node, basic_workflow)
        # The fast-path dspy regex won't match a multi-base class, so
        # this exercises the fallback path with name disambiguation —
        # picks Code (matches the node name) over Mixin.
        assert class_name == "Code"
