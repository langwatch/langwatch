"""Token accounting for a block of langchain LLM calls.

langchain-community's `get_openai_callback` is the usual way to do this, but
importing it drags in `langchain_core.tracers.langchain_v1`, which langchain-core
1.x removed, so it cannot be used on the 1.x line. Only the prompt and completion
counters are needed here (cost is priced by litellm afterwards), so the handler is
built directly on the langchain-core callback surface instead.
"""

import threading
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Generator, Optional

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from langchain_core.tracers.context import register_configure_hook


class TokenUsageCallbackHandler(BaseCallbackHandler):
    """Sums prompt and completion tokens across every LLM call in a block."""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self.successful_requests = 0

    def __repr__(self) -> str:
        return (
            f"Prompt tokens: {self.prompt_tokens}\n"
            f"Completion tokens: {self.completion_tokens}\n"
            f"Total tokens: {self.total_tokens}\n"
            f"Successful requests: {self.successful_requests}"
        )

    @property
    def always_verbose(self) -> bool:
        return True

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        prompt_tokens, completion_tokens = self._extract_usage(response)

        with self._lock:
            self.successful_requests += 1
            self.prompt_tokens += prompt_tokens
            self.completion_tokens += completion_tokens
            self.total_tokens += prompt_tokens + completion_tokens

    @staticmethod
    def _extract_usage(response: LLMResult) -> tuple[int, int]:
        """Read usage off a chat message, falling back to the llm_output block.

        Chat models report usage on the AIMessage; completion models and any
        provider that skips `usage_metadata` report it under
        `llm_output["token_usage"]`.
        """
        try:
            generation = response.generations[0][0]
        except IndexError:
            generation = None

        if isinstance(generation, ChatGeneration):
            message = generation.message
            if isinstance(message, AIMessage) and message.usage_metadata:
                usage = message.usage_metadata
                return usage.get("input_tokens", 0), usage.get("output_tokens", 0)

        token_usage = (response.llm_output or {}).get("token_usage")
        if not token_usage:
            return 0, 0
        return (
            token_usage.get("prompt_tokens", 0),
            token_usage.get("completion_tokens", 0),
        )


token_usage_callback_var: ContextVar[Optional[TokenUsageCallbackHandler]] = ContextVar(
    "token_usage_callback", default=None
)
register_configure_hook(token_usage_callback_var, True)


@contextmanager
def get_token_usage_callback() -> Generator[TokenUsageCallbackHandler, None, None]:
    """Attach a token counter to every langchain call made inside the block."""
    handler = TokenUsageCallbackHandler()
    token_usage_callback_var.set(handler)
    try:
        yield handler
    finally:
        token_usage_callback_var.set(None)
