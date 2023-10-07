from typing import List, Literal, Optional, TypedDict


class StepInput(TypedDict):
    type: Literal["text"]
    value: str


class StepOutput(TypedDict):
    type: Literal["text"]
    value: str


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
    raw_response: dict
    params: StepParams
    metrics: StepMetrics
    timestamps: StepTimestamps
