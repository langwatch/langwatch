from typing import List, Literal, Optional, TypedDict, Union


class TypedValueText(TypedDict):
    type: Literal["text"]
    value: str


class ChatMessage(TypedDict, total=False):
    role: Literal["system", "user", "assistant", "function"]
    content: str
    name: Optional[str]


class TypedValueChatMessages(TypedDict):
    type: Literal["chat_messages"]
    value: List[ChatMessage]


class ErrorCapture(TypedDict):
    message: str
    stacktrace: List[str]


StepInput = Union[TypedValueText, TypedValueChatMessages]

StepOutput = Union[TypedValueText, TypedValueChatMessages]


class StepMetrics(TypedDict, total=False):
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]


class StepParams(TypedDict, total=False):
    temperature: float
    stream: bool


class StepTimestamps(TypedDict, total=False):
    requested_at: int
    first_token_at: Optional[int]
    finished_at: int


class StepTrace(TypedDict):
    trace_id: str
    model: str
    input: StepInput
    outputs: List[StepOutput]
    raw_response: Optional[Union[dict, list]]
    error: Optional[ErrorCapture]
    params: StepParams
    metrics: StepMetrics
    timestamps: StepTimestamps
