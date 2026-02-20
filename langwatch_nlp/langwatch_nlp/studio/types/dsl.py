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
    json_schema = "json_schema"
    chat_messages = "chat_messages"
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
    json_schema: Optional[Dict[str, Any]] = None


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
    http = "http"
    agent = "agent"


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
    # Sampling parameters
    top_p: Optional[float] = None
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None
    seed: Optional[int] = None
    top_k: Optional[int] = None
    min_p: Optional[float] = None
    repetition_penalty: Optional[float] = None
    # Reasoning parameter (canonical/unified field)
    # Provider-specific mapping happens at runtime in utils.py
    reasoning: Optional[str] = None
    # Provider-specific fields - kept for backward compatibility reading old data
    reasoning_effort: Optional[str] = None  # OpenAI (legacy)
    thinkingLevel: Optional[str] = None  # Gemini (legacy)
    effort: Optional[str] = None  # Anthropic (legacy)
    litellm_params: Optional[Dict[str, str]] = None


class DatasetInline(BaseModel):
    records: Dict[str, List[Any]]
    columnTypes: DatasetColumns


class NodeDataset(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    inline: Optional[DatasetInline] = None


class Entry(BaseComponent):
    inputs: None = None
    dataset: Optional[NodeDataset] = None
    entry_selection: Optional[str] | int = None
    train_size: float
    test_size: float
    seed: int


class Signature(BaseComponent):
    pass


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


class HttpAuthConfig(BaseModel):
    """Authentication configuration for HTTP node."""

    type: Literal["bearer", "api_key", "basic"]
    # For bearer auth
    token: Optional[str] = None
    # For api_key auth
    header: Optional[str] = None
    value: Optional[str] = None
    # For basic auth
    username: Optional[str] = None
    password: Optional[str] = None


class HttpConfig(BaseModel):
    """HTTP request configuration."""

    url: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] = "POST"
    body_template: Optional[str] = None
    output_path: Optional[str] = None
    auth: Optional[HttpAuthConfig] = None
    headers: Optional[Dict[str, str]] = None
    timeout_ms: Optional[int] = None


class Http(BaseComponent):
    """HTTP node component for making external API calls.

    HTTP configuration is stored in `parameters` like other node types:
    - url: str - The endpoint URL
    - method: str - HTTP method (GET, POST, PUT, DELETE, PATCH)
    - body_template: str - Request body with {{variable}} placeholders
    - output_path: str - JSONPath to extract response (e.g., $.content)
    - headers: dict - Custom headers
    - auth_type: str - Authentication type (none, bearer, api_key, basic)
    - auth_token: str - Bearer token (for bearer auth)
    - auth_header: str - Header name (for api_key auth)
    - auth_value: str - Header value (for api_key auth)
    - auth_username: str - Username (for basic auth)
    - auth_password: str - Password (for basic auth)
    - timeout_ms: int - Request timeout in milliseconds

    This follows the same pattern as Code, Signature, and other nodes.
    """
    pass


class Agent(BaseComponent):
    """Agent node component.

    Agent nodes reference a DB-backed agent via `agent: "agents/<id>"`.
    The agent's underlying type (http, code, workflow) is determined by the
    `agent_type` parameter. The parser delegates to the appropriate executor
    based on this parameter.
    """
    agent: Optional[str] = None
    agent_type: Optional[str] = None


class End(BaseComponent):
    pass


class Evaluator(BaseComponent):
    evaluator: Optional[str] = None
    outputs: List[Field] = []


Component = Union[
    BaseComponent, Entry, Signature, PromptingTechnique, Code, Evaluator, End, Http, Agent
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


class HttpNode(BaseNode):
    type: Literal["http"] = "http"
    data: Http


class AgentNode(BaseNode):
    type: Literal["agent"] = "agent"
    data: Agent


Node = Union[
    SignatureNode,
    PromptingTechniqueNode,
    CodeNode,
    CustomNode,
    EntryNode,
    RetrieverNode,
    EvaluatorNode,
    EndNode,
    HttpNode,
    AgentNode,
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
    project_id: Optional[str] = None
    experiment_id: Optional[str] = None
    spec_version: str
    name: str
    icon: str
    description: str
    version: str
    default_llm: Optional[LLMConfig] = None
    nodes: List[Node]
    edges: List[Edge]
    state: WorkflowState
    template_adapter: Literal["default", "dspy_chat_adapter"]
    enable_tracing: Optional[bool] = True
    workflow_type: Optional[Literal["component", "evaluator", "workflow"]] = None
    secrets: Optional[Dict[str, str]] = None
