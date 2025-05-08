import time
from typing import Any, Dict, Optional, Union, List
from pydantic import BaseModel
from typing_extensions import Literal
from langwatch_nlp.studio.types.dsl import (
    EvaluationExecutionState,
    ExecutionState,
    ExecutionStatus,
    LLMConfig,
    Node,
    OptimizationExecutionState,
    Timestamps,
    Workflow,
    WorkflowExecutionState,
)
from langevals_core.base_evaluator import Money


class IsAlive(BaseModel):
    type: Literal["is_alive"] = "is_alive"
    payload: dict = {}


class ExecuteComponentPayload(BaseModel):
    trace_id: str
    workflow: Workflow
    node_id: str
    workflow_id: Optional[str] = None
    version_id: Optional[str] = None
    published_id: Optional[str] = None
    inputs: Dict[str, Any]


class ExecuteComponent(BaseModel):
    type: Literal["execute_component"] = "execute_component"
    payload: ExecuteComponentPayload


class StopExecutionPayload(BaseModel):
    trace_id: str
    node_id: Optional[str] = None


class StopExecution(BaseModel):
    type: Literal["stop_execution"] = "stop_execution"
    payload: StopExecutionPayload


class ExecuteFlowPayload(BaseModel):
    trace_id: str
    workflow: Workflow
    until_node_id: Optional[str] = None
    inputs: Optional[List[Dict[str, Any]]] = None
    manual_execution_mode: Optional[bool] = None
    do_not_trace: bool = False


class ExecuteFlow(BaseModel):
    type: Literal["execute_flow"] = "execute_flow"
    payload: ExecuteFlowPayload


class ExecuteEvaluationPayload(BaseModel):
    run_id: str
    workflow: Workflow
    workflow_version_id: str
    evaluate_on: Literal["full", "test", "train"]


class ExecuteEvaluation(BaseModel):
    type: Literal["execute_evaluation"] = "execute_evaluation"
    payload: ExecuteEvaluationPayload


class StopEvaluationExecutionPayload(BaseModel):
    workflow: Workflow
    run_id: str


class StopEvaluationExecution(BaseModel):
    type: Literal["stop_evaluation_execution"] = "stop_evaluation_execution"
    payload: StopEvaluationExecutionPayload


class ExecuteOptimizationParams(BaseModel):
    llm: Optional[LLMConfig] = None
    num_candidates: Optional[int] = None
    max_bootstrapped_demos: Optional[int] = None
    max_labeled_demos: Optional[int] = None
    max_rounds: Optional[int] = None
    num_candidate_programs: Optional[int] = None


class ExecuteOptimizationPayload(BaseModel):
    run_id: str
    workflow: Workflow
    workflow_version_id: str
    optimizer: Literal["MIPROv2ZeroShot", "BootstrapFewShotWithRandomSearch", "MIPROv2"]
    params: ExecuteOptimizationParams
    s3_cache_key: Optional[str] = None


class ExecuteOptimization(BaseModel):
    type: Literal["execute_optimization"] = "execute_optimization"
    payload: ExecuteOptimizationPayload


class StopOptimizationExecutionPayload(BaseModel):
    workflow: Workflow
    run_id: str


class StopOptimizationExecution(BaseModel):
    type: Literal["stop_optimization_execution"] = "stop_optimization_execution"
    payload: StopOptimizationExecutionPayload


StudioClientEvent = Union[
    IsAlive,
    ExecuteComponent,
    StopExecution,
    ExecuteFlow,
    ExecuteEvaluation,
    StopEvaluationExecution,
    ExecuteOptimization,
    StopOptimizationExecution,
]


class IsAliveResponse(BaseModel):
    type: Literal["is_alive_response"] = "is_alive_response"


class ComponentStateChangePayload(BaseModel):
    component_id: str
    execution_state: ExecutionState


class ComponentStateChange(BaseModel):
    type: Literal["component_state_change"] = "component_state_change"
    payload: ComponentStateChangePayload


class ExecutionStateChangePayload(BaseModel):
    execution_state: WorkflowExecutionState


class ExecutionStateChange(BaseModel):
    type: Literal["execution_state_change"] = "execution_state_change"
    payload: ExecutionStateChangePayload


class EvaluationStateChangePayload(BaseModel):
    evaluation_state: EvaluationExecutionState


class EvaluationStateChange(BaseModel):
    type: Literal["evaluation_state_change"] = "evaluation_state_change"
    payload: EvaluationStateChangePayload


class OptimizationStateChangePayload(BaseModel):
    optimization_state: OptimizationExecutionState


class OptimizationStateChange(BaseModel):
    type: Literal["optimization_state_change"] = "optimization_state_change"
    payload: OptimizationStateChangePayload


class DebugPayload(BaseModel):
    message: str


class Debug(BaseModel):
    type: Literal["debug"] = "debug"
    payload: DebugPayload


class ErrorPayload(BaseModel):
    message: str


class Error(BaseModel):
    type: Literal["error"] = "error"
    payload: ErrorPayload


class Done(BaseModel):
    type: Literal["done"] = "done"


StudioServerEvent = Union[
    IsAliveResponse,
    ComponentStateChange,
    ExecutionStateChange,
    EvaluationStateChange,
    OptimizationStateChange,
    Debug,
    Error,
    Done,
]


def start_component_event(
    node: Node, trace_id: str, inputs: Optional[Dict[str, Any]] = None
):
    execution_state = ExecutionState(
        status=ExecutionStatus.running,
        trace_id=trace_id,
        timestamps=Timestamps(started_at=int(time.time() * 1000)),
    )
    if inputs:
        execution_state.inputs = inputs
    return ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=node.id,
            execution_state=execution_state,
        )
    )


def end_component_event(
    node: Node, trace_id: str, result: Any, cost: Optional[Union[float, Money]] = None
):
    try:
        outputs = dict(result)
        if "inputs" in outputs and type(outputs["inputs"]) == dict:
            del outputs["inputs"]
    except Exception:
        raise ValueError(
            f"Node {node.id} must return a dict or dict-like object, instead got: {result.__repr__()}"
        )

    return ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=node.id,
            execution_state=ExecutionState(
                status=ExecutionStatus.success,
                trace_id=trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                outputs=outputs,
                cost=cost.amount if isinstance(cost, Money) else cost,
            ),
        )
    )


def component_error_event(trace_id: str, node_id: str, error: str):
    return ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=node_id,
            execution_state=ExecutionState(
                status=ExecutionStatus.error,
                error=error,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
            ),
        )
    )


def get_trace_id(event: StudioClientEvent):
    return (
        event.payload.trace_id  # type: ignore
        if hasattr(event.payload, "trace_id")
        else (
            event.payload.run_id  # type: ignore
            if hasattr(event.payload, "run_id")
            else None
        )
    )
