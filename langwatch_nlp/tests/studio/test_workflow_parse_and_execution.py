import copy
import json
import pytest
from langwatch_nlp.studio.dspy.evaluation import PredictionWithEvaluationAndMetadata
from langwatch_nlp.studio.parser import (
    materialized_component_class,
    parse_workflow,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.types.dsl import (
    Code,
    CodeNode,
    NodeDataset,
    DatasetInline,
    Edge,
    End,
    EndNode,
    Entry,
    EntryNode,
    Evaluator,
    EvaluatorNode,
    Field,
    FieldType,
    LLMConfig,
    Retriever,
    RetrieverNode,
    Signature,
    SignatureNode,
    Workflow,
    WorkflowState,
)
from langwatch_nlp.studio.utils import disable_dsp_caching
import dspy


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

simple_workflow = Workflow(
    workflow_id="simple-rag",
    api_key="",
    spec_version="1.3",
    name="Simple RAG",
    icon="🧩",
    description="Query transformation, vector database search and answer generation",
    version="1.3",
    nodes=[
        EntryNode(
            id="entry",
            data=Entry(
                name="Entry",
                cls=None,
                parameters=None,
                inputs=None,
                outputs=[
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
                        identifier="gold_answer",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                ],
                train_size=0.5,
                test_size=0.5,
                seed=42,
                dataset=NodeDataset(
                    name="Draft Dataset",
                    inline=DatasetInline(
                        records={
                            "question": [
                                "What is the capital of the moon?",
                                "What is the capital france?",
                            ],
                            "gold_answer": [
                                "The moon has no capital",
                                "The capital of france is Paris",
                            ],
                        },
                        columnTypes=[
                            DatasetColumn(
                                name="question", type=DatasetColumnType.string
                            ),
                            DatasetColumn(
                                name="gold_answer", type=DatasetColumnType.string
                            ),
                        ],
                    ),
                ),
            ),
            type="entry",
        ),  # type: ignore
        SignatureNode(
            id="generate_answer",
            data=Signature(
                name="GenerateAnswer",
                cls=None,
                parameters=[llm_field],
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
        ),
        SignatureNode(
            id="generate_query",
            data=Signature(
                name="GenerateQuery",
                cls=None,
                parameters=[llm_field],
                inputs=[
                    Field(
                        identifier="question",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    )
                ],
                outputs=[
                    Field(
                        identifier="query",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    )
                ],
                execution_state=None,
            ),
            type="signature",
        ),
        EndNode(
            id="end",
            data=End(
                name=None,
                cls=None,
                parameters=None,
                inputs=[
                    Field(
                        identifier="result",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    )
                ],
                outputs=None,
                execution_state=None,
            ),
            type="end",
        ),
        EvaluatorNode(
            id="exact_match_evaluator",
            data=Evaluator(
                name="Evaluator",
                cls="ExactMatchEvaluator",
                inputs=[
                    Field(
                        identifier="output",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                    Field(
                        identifier="expected_output",
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
                        identifier="score",
                        type=FieldType.float,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                    Field(
                        identifier="passed",
                        type=FieldType.bool,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                ],
            ),
            type="evaluator",
        ),
    ],
    edges=[
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="generate_query",
            targetHandle="inputs.question",
            type="default",
        ),
        Edge(
            id="e1-2",
            source="generate_query",
            sourceHandle="outputs.query",
            target="generate_answer",
            targetHandle="inputs.query",
            type="default",
        ),
        Edge(
            id="e2-3",
            source="entry",
            sourceHandle="outputs.question",
            target="generate_answer",
            targetHandle="inputs.question",
            type="default",
        ),
        Edge(
            id="e3-4",
            source="generate_answer",
            sourceHandle="outputs.answer",
            target="end",
            targetHandle="end.result",
            type="default",
        ),
        Edge(
            id="e4-5",
            source="generate_answer",
            sourceHandle="outputs.answer",
            target="exact_match_evaluator",
            targetHandle="inputs.output",
            type="default",
        ),
        Edge(
            id="e5-6",
            source="entry",
            sourceHandle="outputs.gold_answer",
            target="exact_match_evaluator",
            targetHandle="inputs.expected_output",
            type="default",
        ),
    ],
    state=WorkflowState(execution=None, evaluation=None),
)


@pytest.mark.integration
def test_parse_workflow():
    disable_dsp_caching()

    class_name, code = parse_workflow(simple_workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module(run_evaluations=True)  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France? Reply in a single word with no period.",
            gold_answer="Paris",
        )
    assert "Paris" in result["end"]["result"]
    assert result.cost > 0
    assert result.duration > 0

    assert result.total_score() == 1.0
    assert result.evaluations["exact_match_evaluator"].status == "processed"
    assert result.evaluations["exact_match_evaluator"].score == 1.0


@pytest.mark.integration
def test_parse_parallel_execution_workflow():
    disable_dsp_caching()
    workflow = Workflow(
        workflow_id="simple-rag",
        api_key="",
        spec_version="1.3",
        name="Simple RAG",
        icon="🧩",
        description="Query transformation, vector database search and answer generation",
        version="1.3",
        nodes=[
            EntryNode(
                id="entry",
                data=Entry(
                    name="Entry",
                    cls=None,
                    parameters=None,
                    inputs=None,
                    outputs=[
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
                            identifier="gold_answer",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    train_size=0.5,
                    test_size=0.5,
                    seed=42,
                    dataset=NodeDataset(
                        name="Draft Dataset",
                        inline=DatasetInline(
                            records={
                                "question": [
                                    "What is the capital of the moon?",
                                    "What is the capital france?",
                                ],
                                "gold_answer": [
                                    "The moon has no capital",
                                    "The capital of france is Paris",
                                ],
                            },
                            columnTypes=[
                                DatasetColumn(
                                    name="question", type=DatasetColumnType.string
                                ),
                                DatasetColumn(
                                    name="gold_answer", type=DatasetColumnType.string
                                ),
                            ],
                        ),
                    ),
                ),
                type="entry",
            ),  # type: ignore
            SignatureNode(
                id="generate_correct_answer",
                data=Signature(
                    name="GenerateCorrectAnswer",
                    cls=None,
                    parameters=[llm_field],
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
            ),
            SignatureNode(
                id="wrong_answers_only",
                data=Signature(
                    name="WrongAnswersOnly",
                    cls=None,
                    parameters=[
                        llm_field,
                        Field(
                            identifier="instructions",
                            type=FieldType.str,
                            optional=None,
                            value="You generate Wrong Answers Only (tm)",
                            desc=None,
                            prefix=None,
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
                        )
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
                        )
                    ],
                    execution_state=None,
                ),
                type="signature",
            ),
            EndNode(
                id="end",
                data=End(
                    name=None,
                    cls=None,
                    parameters=None,
                    inputs=[
                        Field(
                            identifier="result",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                    outputs=None,
                    execution_state=None,
                ),
                type="end",
            ),
            EvaluatorNode(
                id="exact_match_evaluator",
                data=Evaluator(
                    name="Evaluator",
                    cls="ExactMatchEvaluator",
                    inputs=[
                        Field(
                            identifier="output",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="expected_output",
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
                            identifier="score",
                            type=FieldType.float,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="passed",
                            type=FieldType.bool,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                ),
                type="evaluator",
            ),
        ],
        edges=[
            Edge(
                id="e0-1",
                source="entry",
                sourceHandle="outputs.question",
                target="generate_correct_answer",
                targetHandle="inputs.question",
                type="default",
            ),
            Edge(
                id="e1-2",
                source="entry",
                sourceHandle="outputs.question",
                target="wrong_answers_only",
                targetHandle="inputs.question",
                type="default",
            ),
            Edge(
                id="e3-4",
                source="generate_correct_answer",
                sourceHandle="outputs.answer",
                target="end",
                targetHandle="end.correct_answer",
                type="default",
            ),
            Edge(
                id="e4-5",
                source="wrong_answers_only",
                sourceHandle="outputs.answer",
                target="end",
                targetHandle="end.wrong_answer",
                type="default",
            ),
            Edge(
                id="e5-6",
                source="generate_correct_answer",
                sourceHandle="outputs.answer",
                target="exact_match_evaluator",
                targetHandle="inputs.expected_output",
                type="default",
            ),
            Edge(
                id="e6-7",
                source="wrong_answers_only",
                sourceHandle="outputs.answer",
                target="exact_match_evaluator",
                targetHandle="inputs.output",
                type="default",
            ),
        ],
        state=WorkflowState(execution=None, evaluation=None),
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )
    assert "Paris" in result["end"]["correct_answer"]
    assert "Paris" not in result["end"]["wrong_answer"]
    assert result.cost > 0
    assert result.duration > 0


@pytest.mark.integration
def test_parse_workflow_with_orphan_nodes():
    disable_dsp_caching()
    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        SignatureNode(
            id="orphan",
            data=Signature(
                name="Orphan",
                cls=None,
                parameters=[llm_field],
                inputs=[],
                outputs=[],
            ),
            type="signature",
        )
    )
    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )
    assert "Paris" in result["end"]["result"]
    assert result.cost > 0
    assert result.duration > 0


@pytest.mark.integration
def test_parse_workflow_with_infinite_loop():
    disable_dsp_caching()
    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        SignatureNode(
            id="infinite_loop",
            data=Signature(
                name="InfiniteLoop",
                cls=None,
                parameters=[llm_field],
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
                        identifier="second_question",
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
                    )
                ],
                execution_state=None,
            ),
            type="signature",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="infinite_loop",
            targetHandle="inputs.question",
            type="default",
        )
    )
    workflow.edges.append(
        Edge(
            id="e1-2",
            source="infinite_loop",
            sourceHandle="outputs.answer",
            target="generate_query",
            targetHandle="inputs.question",
            type="default",
        )
    )
    workflow.edges.append(
        Edge(
            id="e2-3",
            source="generate_query",
            sourceHandle="outputs.answer",
            target="infinite_loop",
            targetHandle="inputs.second_question",
            type="default",
        )
    )

    with pytest.raises(Exception) as e:
        parse_workflow(workflow, format=True, debug_level=2)

    assert "Cyclic dependency detected" in str(e.value)


@pytest.mark.integration
def test_langwatch_evaluator_with_settings():
    disable_dsp_caching()
    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        EvaluatorNode(
            id="langwatch_evaluator",
            data=Evaluator(
                name="PII Detection Evaluator",
                cls="LangWatchEvaluator",
                evaluator="presidio/pii_detection",
                inputs=[
                    Field(
                        identifier="input",
                        type=FieldType.str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                ],
                outputs=[],
                parameters=[
                    Field(
                        identifier="min_threshold",
                        type=FieldType.str,
                        optional=None,
                        value="0.5",
                        desc=None,
                        prefix=None,
                        hidden=None,
                    ),
                    Field(
                        identifier="entities",
                        type=FieldType.str,
                        optional=None,
                        value={
                            "credit_card": True,
                            "email_address": True,
                            "person": True,
                            "location": True,
                        },
                        desc=None,
                        prefix=None,
                    ),
                ],
            ),
            type="evaluator",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="generate_answer",
            sourceHandle="outputs.answer",
            target="langwatch_evaluator",
            targetHandle="inputs.input",
            type="default",
        )
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )

    assert result.cost > 0
    assert result.duration > 0


@pytest.mark.integration
def test_parse_workflow_with_until_node():
    disable_dsp_caching()

    class_name, code = parse_workflow(
        simple_workflow, format=True, debug_level=1, until_node_id="generate_query"
    )
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )
    assert "Paris" in result["generate_query"]["query"]
    assert result.cost > 0
    assert result.duration > 0


@pytest.mark.integration
def test_parse_workflow_with_default_llm():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    workflow.default_llm = LLMConfig(
        model="gpt-4o-mini", temperature=0.0, max_tokens=100
    )

    generate_query_node = next(
        node for node in workflow.nodes if node.data.name == "GenerateQuery"
    )
    generate_query_node.data.parameters = []

    generate_answer_node = next(
        node for node in workflow.nodes if node.data.name == "GenerateAnswer"
    )
    generate_answer_node.data.parameters = []

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)

    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )

    assert not result.error
    assert result.cost > 0
    assert result.duration > 0


@pytest.mark.integration
def test_blows_up_with_execution_error():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        CodeNode(
            id="blows_up",
            data=Code(
                name="BlowsUp",
                cls=None,
                parameters=[
                    Field(
                        identifier="code",
                        type=FieldType.str,
                        optional=None,
                        value="""
import dspy

class BlowsUp(dspy.Module):
    def forward(self, **kwargs):
        raise Exception('Blows up')
                        """,
                        desc=None,
                        prefix=None,
                    ),
                ],
                inputs=[],
                outputs=[],
            ),
            type="code",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="blows_up",
            targetHandle="inputs.question",
            type="default",
        )
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore

    with pytest.raises(Exception) as e:
        instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )

    assert "Blows up" in str(e.value)


@pytest.mark.integration
def test_does_not_blow_up_with_error_handling():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        CodeNode(
            id="blows_up",
            data=Code(
                name="BlowsUp",
                cls=None,
                parameters=[
                    Field(
                        identifier="code",
                        type=FieldType.str,
                        optional=None,
                        value="""
import dspy

class BlowsUp(dspy.Module):
    def forward(self, **kwargs):
        raise Exception('Blows up')
                        """,
                        desc=None,
                        prefix=None,
                    ),
                ],
                inputs=[],
                outputs=[],
            ),
            type="code",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="blows_up",
            targetHandle="inputs.question",
            type="default",
        )
    )

    class_name, code = parse_workflow(
        workflow, format=True, debug_level=1, handle_errors=True
    )
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore

    result = instance(
        question="What is the capital of France?",
        gold_answer="Paris",
    )

    assert "Blows up" in str(result.error)


@pytest.mark.integration
def test_autoparse_fields():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)

    workflow.nodes.append(
        CodeNode(
            id="check_input_types",
            data=Code(
                name="CheckInputTypes",
                cls=None,
                parameters=[
                    Field(
                        identifier="code",
                        type=FieldType.str,
                        optional=None,
                        value="""
import dspy

class CheckInputTypes(dspy.Module):
    def forward(self, field_list_str: list[str], field_float: float):
        return {"field_list_str": type(field_list_str), "field_float": type(field_float)}
                        """,
                        desc=None,
                        prefix=None,
                    ),
                ],
                inputs=[
                    Field(
                        identifier="field_list_str",
                        type=FieldType.list_str,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                    ),
                    Field(
                        identifier="field_float",
                        type=FieldType.float,
                        optional=None,
                        value=None,
                        desc=None,
                        prefix=None,
                    ),
                ],
                outputs=[],
            ),
            type="code",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="check_input_types",
            targetHandle="inputs.field_list_str",
            type="default",
        )
    )
    workflow.edges.append(
        Edge(
            id="e1-2",
            source="entry",
            sourceHandle="outputs.gold_answer",
            target="check_input_types",
            targetHandle="inputs.field_float",
            type="default",
        )
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = instance(
        question=json.dumps(
            ["What is the capital of France?", "What is the capital of Germany?"]
        ),
        gold_answer="170",
    )

    assert result["check_input_types"]["field_list_str"] == list
    assert result["check_input_types"]["field_float"] == float


@pytest.mark.integration
def test_parse_workflow_when_entry_has_special_characters():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    entry_node = next(node for node in workflow.nodes if node.type == "entry")

    (entry_node.data.outputs or []).append(
        Field(
            identifier="question (2)",
            type=FieldType.str,
            optional=None,
        )
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module(run_evaluations=True)  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France? Reply in a single word with no period.",
            gold_answer="Paris",
        )
    assert "Paris" in result["end"]["result"]
    assert result.cost > 0
    assert result.duration > 0

    assert result.total_score() == 1.0
    assert result.evaluations["exact_match_evaluator"].status == "processed"
    assert result.evaluations["exact_match_evaluator"].score == 1.0


@pytest.mark.integration
def test_proposes_instructions_with_grounded_proposer():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    generate_answer_node = next(
        node for node in workflow.nodes if node.data.name == "GenerateAnswer"
    )
    generate_answer_node.data.parameters = [
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
    ]

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module(run_evaluations=True)  # type: ignore

        from dspy.propose.grounded_proposer import GroundedProposer

        proposer = GroundedProposer(
            prompt_model=dspy.LM(model="openai/gpt-4o-mini"),
            program=instance,
            trainset=[],
        )
        proposed_instructions = proposer.propose_instructions_for_program(
            trainset=[],
            program=instance,
            demo_candidates=[],
            trial_logs=[],
            N=2,
            T=1,
        )

        assert len(proposed_instructions) == 2


@pytest.mark.integration
def test_parse_workflow_with_retriever():
    disable_dsp_caching()

    workflow = copy.deepcopy(simple_workflow)
    workflow.nodes.append(
        RetrieverNode(
            id="retriever",
            data=Retriever(
                name="Retriever",
                cls="ColBERTv2",
                parameters=[
                    Field(
                        identifier="k",
                        type=FieldType.int,
                        optional=None,
                        value=3,
                    ),
                    Field(
                        identifier="url",
                        type=FieldType.str,
                        optional=None,
                        value="http://20.102.90.50:2017/wiki17_abstracts",
                    ),
                ],
            ),
            type="retriever",
        )
    )
    workflow.edges.append(
        Edge(
            id="e0-1",
            source="entry",
            sourceHandle="outputs.question",
            target="retriever",
            targetHandle="inputs.query",
            type="default",
        )
    )

    class_name, code = parse_workflow(workflow, format=True, debug_level=1)
    with materialized_component_class(
        component_code=code, class_name=class_name
    ) as Module:
        instance = Module()  # type: ignore
        result: PredictionWithEvaluationAndMetadata = instance(
            question="What is the capital of France?",
            gold_answer="Paris",
        )

    assert "Paris" in result["retriever"].contexts[0]
