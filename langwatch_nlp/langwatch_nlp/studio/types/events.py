import time
from typing import Dict, Optional, Union
from pydantic import BaseModel
from typing_extensions import Literal
from langwatch_nlp.studio.types.dsl import (
    ExecutionState,
    ExecutionStatus,
    Node,
    Timestamps,
    Workflow,
    WorkflowExecutionState,
)


class IsAlive(BaseModel):
    type: Literal["is_alive"] = "is_alive"
    payload: dict = {}


class ExecuteComponentPayload(BaseModel):
    trace_id: str
    workflow: Workflow
    node_id: str
    inputs: Dict[str, str]


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


class ExecuteFlow(BaseModel):
    type: Literal["execute_flow"] = "execute_flow"
    payload: ExecuteFlowPayload


StudioClientEvent = Union[IsAlive, ExecuteComponent, StopExecution, ExecuteFlow]


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
    IsAliveResponse, ComponentStateChange, ExecutionStateChange, Debug, Error, Done
]


def start_component_event(
    node: Node, trace_id: str, inputs: Optional[Dict[str, str]] = None
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


def end_component_event(node: Node, trace_id: str, outputs: Dict[str, str], cost: Optional[float] = None):
    return ComponentStateChange(
        payload=ComponentStateChangePayload(
            component_id=node.id,
            execution_state=ExecutionState(
                status=ExecutionStatus.success,
                trace_id=trace_id,
                timestamps=Timestamps(finished_at=int(time.time() * 1000)),
                outputs=outputs,
                cost=cost,
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
