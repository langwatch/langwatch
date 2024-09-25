import os
import pytest
from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM
from langwatch_nlp.studio.dspy.workflow_module import (
    PredictionWithEvaluationCostAndDuration,
    WorkflowModule,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.types.dsl import (
    Dataset,
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


@pytest.mark.integration
def test_parse_workflow():
    disable_dsp_caching()
    workflow = Workflow(
        api_key="",
        spec_version="1.0",
        name="Simple RAG",
        icon="🧩",
        description="Query transformation, vector database search and answer generation",
        version="1.0",
        default_llm=LLMConfig(
            model="openai/gpt-4o-mini",
            temperature=0.0,
            max_tokens=2048,
            litellm_params={
                "api_key": os.environ["OPENAI_API_KEY"],
                "model": "openai/gpt-4o-mini",
            },
        ),
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
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="gold_answer",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    decorated_by=None,
                    execution_state=None,
                    dataset=Dataset(
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
            ),
            SignatureNode(
                id="generate_answer",
                data=Signature(
                    name="GenerateAnswer",
                    cls=None,
                    parameters=None,
                    inputs=[
                        Field(
                            identifier="question",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="query",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    outputs=[
                        Field(
                            identifier="answer",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    decorated_by=None,
                    execution_state=None,
                    prompt=None,
                    llm=None,
                ),
                type="signature",
            ),
            SignatureNode(
                id="generate_query",
                data=Signature(
                    name="GenerateQuery",
                    cls=None,
                    parameters=None,
                    inputs=[
                        Field(
                            identifier="question",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                    outputs=[
                        Field(
                            identifier="query",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                    decorated_by=None,
                    execution_state=None,
                    prompt=None,
                    llm=None,
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
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                    outputs=None,
                    decorated_by=None,
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
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="expected_output",
                            type=FieldType.str,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    outputs=[
                        Field(
                            identifier="score",
                            type=FieldType.float,
                            optional=None,
                            defaultValue=None,
                            description=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="passed",
                            type=FieldType.bool,
                            optional=None,
                            defaultValue=None,
                            description=None,
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

    module = WorkflowModule(workflow, execute_evaluators=False)
    result: PredictionWithEvaluationCostAndDuration = module(
        question="What is the capital of France?",
        gold_answer="Paris",
    )
    assert result["end"]["result"] == "Paris"

    evaluation, evaluation_results = result.evaluation(
        example=dspy.Example(
            question="What is the capital of France?", gold_answer="Paris"
        ),
        return_results=True,
    )

    assert evaluation == 1.0
    assert evaluation_results["exact_match_evaluator"].status == "processed"
    assert evaluation_results["exact_match_evaluator"].score == 1.0
