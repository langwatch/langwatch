import copy
import pytest
from langwatch_nlp.studio.parser_v2 import (
    get_component_class,
    parse_and_instantiate_workflow,
    parse_workflow,
)
from langwatch_nlp.studio.dspy.workflow_module import (
    PredictionWithEvaluationAndMetadata,
    WorkflowModule,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.types.dsl import (
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
@pytest.mark.asyncio
async def test_parse_workflow():
    disable_dsp_caching()

    class_name, code = parse_workflow(simple_workflow, format=True, debug_level=1)
    Module = get_component_class(component_code=code, class_name=class_name)
    instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = await instance(
        inputs={
            "question": "What is the capital of France?",
            "gold_answer": "Paris",
        }
    )
    assert "Paris" in result["end"]["result"]
    assert result.get_cost() > 0
    assert result.get_duration() > 0

    # evaluation, evaluation_results = result.evaluation(
    #     example=dspy.Example(
    #         question="What is the capital of France?", gold_answer="Paris"
    #     ),
    #     return_results=True,
    # )

    # assert evaluation == 1.0
    # assert evaluation_results["exact_match_evaluator"].status == "processed"
    # assert evaluation_results["exact_match_evaluator"].score == 1.0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_parse_parallel_execution_workflow():
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
    Module = get_component_class(component_code=code, class_name=class_name)
    instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = await instance(
        inputs={
            "question": "What is the capital of France?",
            "gold_answer": "Paris",
        }
    )
    assert "Paris" in result["end"]["correct_answer"]
    assert "Paris" not in result["end"]["wrong_answer"]
    assert result.get_cost() > 0
    assert result.get_duration() > 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_parse_workflow_with_orphan_nodes():
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
    print("\n\ncode", code, "\n\n")
    Module = get_component_class(component_code=code, class_name=class_name)
    instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = await instance(
        inputs={
            "question": "What is the capital of France?",
            "gold_answer": "Paris",
        }
    )
    assert "Paris" in result["end"]["result"]
    assert result.get_cost() > 0
    assert result.get_duration() > 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_parse_workflow_with_infinite_loop():
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
@pytest.mark.asyncio
async def test_langwatch_evaluator_with_settings():
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
    Module = get_component_class(component_code=code, class_name=class_name)
    instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = await instance(
        inputs={
            "question": "What is the capital of France?",
            "gold_answer": "Paris",
        }
    )

    assert result.get_cost() > 0
    assert result.get_duration() > 0


@pytest.mark.integration
@pytest.mark.asyncio
async def test_parse_workflow_with_until_node():
    disable_dsp_caching()

    class_name, code = parse_workflow(simple_workflow, format=True, debug_level=1, until_node_id="generate_query")
    print("\n\ncode", code, "\n\n")
    Module = get_component_class(component_code=code, class_name=class_name)
    instance = Module()  # type: ignore
    result: PredictionWithEvaluationAndMetadata = await instance(
        inputs={
            "question": "What is the capital of France?",
            "gold_answer": "Paris",
        }
    )
    assert "Paris" in result["generate_query"]["query"]
    assert result.get_cost() > 0
    assert result.get_duration() > 0

# TODO: test evaluate_prediction
# TODO: test different formats auto-parsing
