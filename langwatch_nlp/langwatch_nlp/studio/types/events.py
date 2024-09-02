from typing import Dict, Optional, Union
from pydantic import BaseModel
from typing_extensions import Literal
from langwatch_nlp.studio.types.dsl import (
    ExecutionState,
    Node,
    WorkflowExecutionState,
)


class ExecuteComponentPayload(BaseModel):
    trace_id: str
    node: Node
    inputs: Dict[str, str]


class ExecuteComponent(BaseModel):
    type: Literal["execute_component"] = "execute_component"
    payload: ExecuteComponentPayload


StudioClientEvent = ExecuteComponent


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


StudioServerEvent = Union[ComponentStateChange, ExecutionStateChange, Debug, Error, Done]
