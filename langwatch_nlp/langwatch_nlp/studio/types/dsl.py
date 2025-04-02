from typing import Any, List, Dict, Union, Optional, Literal
from pydantic import BaseModel
from enum import Enum

from langwatch_nlp.studio.types.dataset import DatasetColumns


class FieldType(str, Enum):
    str = "str"
    image = "image"
    float = "float"
    int = "int"
    bool = "bool"
    list = "list"
    list_str = "list[str]"
    list_float = "list[float]"
    list_int = "list[int]"
    list_bool = "list[bool]"
    dict = "dict"
    signature = "signature"
    llm = "llm"
    prompting_technique = "prompting_technique"
    dataset = "dataset"
    code = "code"


class Field(BaseModel):
    identifier: str
    type: FieldType
    optional: Optional[bool] = None
    value: Optional[Any] = None
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
    code = "code"
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
    description: Optional[str] = None
    cls: Optional[str] = None
    parameters: Optional[List[Field]] = None
    inputs: Optional[List[Field]] = None
    outputs: Optional[List[Field]] = None
    execution_state: Optional[ExecutionState] = None
    workflow_id: Optional[str] = None
    published_id: Optional[str] = None
    isCustom: Optional[bool] = None
    version_id: Optional[str] = None
    behave_as: Optional[Literal["evaluator"]] = None


class Edge(BaseModel):
    id: str
    source: str
    sourceHandle: str
    target: str
    targetHandle: str
    type: str


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
    train_size: float
    test_size: float
    seed: int


class Signature(BaseComponent):
    pass
    # prompt: Optional[str] = None
    # llm: Optional[LLMConfig] = None
    # demonstrations: Optional[NodeDataset] = None


class PromptingTechnique(BaseComponent):
    pass


class NodeRef(BaseModel):
    ref: str


class Code(BaseComponent):
    pass


class Custom(BaseComponent):
    components: Optional[List["Node"]] = None
    forward_pass: Optional[Union[List[Edge], Dict[str, str]]] = None


class Retriever(BaseComponent):
    pass


class End(BaseComponent):
    pass


class Evaluator(BaseComponent):
    evaluator: Optional[str] = None
    outputs: List[Field] = []


Component = Union[
    BaseComponent, Entry, Signature, PromptingTechnique, Code, Evaluator, End
]


class BaseNode(BaseModel):
    id: str
    data: BaseComponent


class SignatureNode(BaseNode):
    type: Literal["signature"] = "signature"
    data: Signature


class CustomNode(BaseNode):
    type: Literal["custom"] = "custom"
    data: Custom


class PromptingTechniqueNode(BaseNode):
    type: Literal["prompting_technique"] = "prompting_technique"
    data: PromptingTechnique


class CodeNode(BaseNode):
    type: Literal["code"] = "code"
    data: Code


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
    SignatureNode,
    PromptingTechniqueNode,
    CodeNode,
    CustomNode,
    EntryNode,
    RetrieverNode,
    EvaluatorNode,
    EndNode,
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
    stdout: Optional[str] = None


class WorkflowState(BaseModel):
    execution: Optional[WorkflowExecutionState] = None
    evaluation: Optional[EvaluationExecutionState] = None
    optimization: Optional[OptimizationExecutionState] = None


class Workflow(BaseModel):
    api_key: str
    workflow_id: str
    experiment_id: Optional[str] = None
    spec_version: str
    name: str
    icon: str
    description: str
    version: str
    nodes: List[Node]
    edges: List[Edge]
    state: WorkflowState
    enable_tracing: Optional[bool] = True
