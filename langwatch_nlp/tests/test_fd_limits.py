#!/usr/bin/env python3
"""
Test script to verify file descriptor limits and SQLite prevention measures.
Run this to check if the Docker configuration is working properly.
"""

# Add this at the very top of your Lambda handler file
import sys
import traceback

class MockSQLite3:
    def __init__(self):
        pass

    def connect(self, *args, **kwargs):
        # Print full stack trace to see who's calling
        print("🚨 SQLITE3 USAGE DETECTED!")
        print("Stack trace:")
        traceback.print_stack()

        # Log the caller details
        frame = sys._getframe(1)
        print(f"Called from: {frame.f_code.co_filename}:{frame.f_lineno}")
        print(f"Function: {frame.f_code.co_name}")

        # Fail hard
        raise RuntimeError("SQLite3 usage is forbidden! Check the stack trace above.")

    def __getattr__(self, name):
        print(f"🚨 Attempting to access sqlite3.{name}")
        traceback.print_stack()
        raise RuntimeError(f"SQLite3 attribute '{name}' access is forbidden!")

# Replace the sqlite3 module
sys.modules["sqlite3"] = MockSQLite3()  # type: ignore

import os
import resource
import tempfile
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import dspy
from random import randint
from dspy.evaluate import Evaluate
import pytest
from langwatch_nlp.studio.utils import disable_dsp_caching
from langwatch_nlp.studio.dspy import (
    LLMNode,
    LangWatchWorkflowModule,
    EvaluationResultWithMetadata,
)
from langwatch_nlp.studio.dspy.evaluation import (
    EvaluationReporting,
    PredictionWithEvaluationAndMetadata,
)
from langwatch_nlp.studio.types.dsl import (
    Signature,
    SignatureNode,
    Workflow,
    WorkflowState,
)
from asyncio import Queue
from langevals_core.base_evaluator import Money


@pytest.mark.asyncio
async def test_file_descriptor_limits():
    soft_limit, hard_limit = resource.getrlimit(resource.RLIMIT_NOFILE)
    print(f"File descriptor limits - Soft: {soft_limit}, Hard: {hard_limit}")

    disable_dsp_caching()

    random_num = randint(0, 1000)

    examples = [
        dspy.Example(_index=i, **{"input": f"test {random_num}"}).with_inputs("input")
        for i in range(soft_limit * 2)
    ]

    evaluator = Evaluate(
        devset=examples,
        num_threads=10,
        display_progress=True,
        display_table=False,
        provide_traceback=True,
    )

    workflow = Workflow(
        workflow_id="basic",
        api_key="",
        spec_version="1.3",
        name="Basic",
        icon="🧩",
        description="Basic workflow",
        version="1.3",
        nodes=[
            SignatureNode(
                id="mock",
                data=Signature(
                    name="mock",
                    cls=None,
                    parameters=[],
                    inputs=[],
                    outputs=[],
                    execution_state=None,
                ),
                type="signature",
            )
        ],
        edges=[],
        state=WorkflowState(execution=None, evaluation=None),
        template_adapter="default",
        workflow_type="workflow",
    )

    class MockSignature(dspy.Signature):
        input: str = dspy.InputField()
        output: str = dspy.OutputField()

    class MockProgram(LLMNode):
        def __init__(self):
            lm = dspy.LM(model="openai/gpt-4.1-nano", cache=False)

            super().__init__(
                node_id="mock",
                name="mock",
                predict=dspy.Predict(MockSignature),
                lm=lm,
            )

        def forward(self, input: str):
            return super().forward(input=input)

    class MockModule(LangWatchWorkflowModule):
        def __init__(self):
            super().__init__()

            self.program = self.wrapped(MockProgram, node_id="mock")()

        def forward(self, input: str):
            self.cost = 0
            self.duration = 0

            result = self.program(input=input)

            return PredictionWithEvaluationAndMetadata(
                cost=0,
                duration=0,
                error=None,
                evaluations={
                    "mock": EvaluationResultWithMetadata(
                        status="processed",
                        score=1,
                        passed=True,
                        label="test",
                        details="test",
                        inputs={"input": input},
                        cost=Money(amount=0, currency="USD"),
                        duration=0,
                    )
                },
                **result,
            )

    reporting = EvaluationReporting(
        workflow,
        workflow_version_id="1",
        run_id="1",
        total=len(examples),
        queue=Queue(),
        weighting="mean",
    )

    module = MockModule()

    results = evaluator(module, metric=reporting.evaluate_and_report)

    # consume queue
    while not reporting.queue.empty():
        item = await reporting.queue.get()  # type: ignore
        if (
            hasattr(item, "payload")
            and hasattr(item.payload, "evaluation_state")  # type: ignore
            and hasattr(item.payload.evaluation_state, "error")  # type: ignore
            and item.payload.evaluation_state.error is not None  # type: ignore
        ):
            print("\n\nitem", item, "\n\n")  # type: ignore


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_file_descriptor_limits())
