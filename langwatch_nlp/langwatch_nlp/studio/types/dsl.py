from typing import Any, List, Dict, Union, Optional, Literal
from pydantic import BaseModel, Field as PydanticField
from enum import Enum

from langwatch_nlp.studio.types.dataset import DatasetColumns


class FieldType(str, Enum):
    str = "str"
    float = "float"
    int = "int"
    bool = "bool"
    list_str = "list[str]"
    list_float = "list[float]"
    list_int = "list[int]"
    list_bool = "list[bool]"
    dict = "dict"
    signature = "signature"
    llm = "llm"


class Field(BaseModel):
    identifier: str
    type: FieldType
    optional: Optional[bool] = None
    defaultValue: Optional[Any] = None
    desc: Optional[str] = None
    prefix: Optional[str] = None
    hidden: Optional[bool] = None


class ExecutionStatus(str, Enum):
    idle = "idle"
    waiting = "waiting"
    running = "running"
    success = "success"
    error = "error"


class ComponentType(str, Enum):
    entry = "entry"
    end = "end"
    signature = "signature"
    module = "module"
    retriever = "retriever"
    prompting_technique = "prompting_technique"
    evaluator = "evaluator"


class Timestamps(BaseModel):
    started_at: Optional[int] = None
    finished_at: Optional[int] = None
    stopped_at: Optional[int] = None


class ExecutionState(BaseModel):
    status: ExecutionStatus
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    error: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    inputs: Optional[Dict[str, Any]] = None
    outputs: Optional[Dict[str, Any]] = None
    cost: Optional[float] = None
    timestamps: Optional[Timestamps] = None


class DecoratedBy(BaseModel):
    ref: str


class BaseComponent(BaseModel):
    _library_ref: Optional[str] = None
    name: Optional[str] = None
    cls: Optional[str] = None
    parameters: Optional[List[Field]] = None
    inputs: Optional[List[Field]] = None
    outputs: Optional[List[Field]] = None
    decorated_by: Optional[DecoratedBy] = None
    execution_state: Optional[ExecutionState] = None


class LLMConfig(BaseModel):
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    litellm_params: Optional[Dict[str, str]] = None


class DatasetInline(BaseModel):
    records: Dict[str, List[Any]]
    columnTypes: DatasetColumns


# Differently from the typescript DSL, we require the dataset to be passed inline in the entry node here
class NodeDataset(BaseModel):
    name: Optional[str] = None
    inline: Optional[DatasetInline] = None


class Entry(BaseComponent):
    inputs: None = None
    dataset: Optional[NodeDataset] = None
    train_test_split: float
    seed: int


class Signature(BaseComponent):
    prompt: Optional[str] = None
    llm: Optional[LLMConfig] = None
    demonstrations: Optional[NodeDataset] = None


class Edge(BaseModel):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str
    type: str


class Module(BaseComponent):
    components: Optional[List["Node"]] = None
    forward_pass: Optional[Union[List[Edge], Dict[str, str]]] = None


class Retriever(BaseComponent):
    pass


class PromptingTechnique(BaseComponent):
    pass


class End(BaseComponent):
    pass


class Evaluator(BaseComponent):
    evaluator: Optional[str] = None
    outputs: List[Field] = []


Component = Union[BaseComponent, Entry, Signature, Module, Evaluator]


class BaseNode(BaseModel):
    id: str
    data: BaseComponent


class SignatureNode(BaseNode):
    type: Literal["signature"] = "signature"
    data: Signature


class ModuleNode(BaseNode):
    type: Literal["module"] = "module"
    data: Module


class EntryNode(BaseNode):
    type: Literal["entry"] = "entry"
    data: Entry


class RetrieverNode(BaseNode):
    type: Literal["retriever"] = "retriever"
    data: Retriever


class EvaluatorNode(BaseNode):
    type: Literal["evaluator"] = "evaluator"
    data: Evaluator


class EndNode(BaseNode):
    type: Literal["end"] = "end"
    data: End


Node = Union[
    SignatureNode, ModuleNode, EntryNode, RetrieverNode, EvaluatorNode, EndNode
]


class Flow(BaseModel):
    nodes: List[Node]
    edges: List[Edge]


class WorkflowExecutionState(BaseModel):
    status: ExecutionStatus
    trace_id: Optional[str] = None
    until_node_id: Optional[str] = None
    error: Optional[str] = None
    timestamps: Optional[Timestamps] = None
    result: Optional[Dict[str, Any]] = None


class EvaluationExecutionState(BaseModel):
    experiment_id: Optional[str] = None
    run_id: Optional[str] = None
    run_name: Optional[str] = None
    status: Optional[ExecutionStatus] = None
    error: Optional[str] = None
    progress: Optional[int] = None
    total: Optional[int] = None
    timestamps: Optional[Timestamps] = None


class OptimizationExecutionState(BaseModel):
    experiment_id: Optional[str] = None
    run_id: Optional[str] = None
    run_name: Optional[str] = None
    status: Optional[ExecutionStatus] = None
    error: Optional[str] = None
    timestamps: Optional[Timestamps] = None


class WorkflowState(BaseModel):
    execution: Optional[WorkflowExecutionState] = None
    evaluation: Optional[EvaluationExecutionState] = None
    optimization: Optional[OptimizationExecutionState] = None


class Workflow(BaseModel):
    api_key: str
    workflow_id: str
    spec_version: str
    name: str
    icon: str
    description: str
    version: str
    default_llm: LLMConfig
    nodes: List[Node]
    edges: List[Edge]
    state: WorkflowState
