"""Token accounting has to keep working without langchain-community.

`capture_cost` prices an evaluation from the prompt and completion token counts
gathered across a block of LLM calls. These tests pin the two shapes langchain
reports usage in, so the counters cannot silently go to zero and price every
evaluation at nothing.
"""

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, Generation, LLMResult

from langevals_ragas.lib.token_usage import (
    TokenUsageCallbackHandler,
    get_token_usage_callback,
    token_usage_callback_var,
)


def _chat_result(input_tokens: int, output_tokens: int) -> LLMResult:
    message = AIMessage(
        content="hello",
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    )
    return LLMResult(generations=[[ChatGeneration(message=message)]])


def _llm_output_result(prompt_tokens: int, completion_tokens: int) -> LLMResult:
    return LLMResult(
        generations=[[Generation(text="hello")]],
        llm_output={
            "token_usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
            },
            "model_name": "gpt-4o-mini",
        },
    )


def test_counts_usage_metadata_from_a_chat_message():
    handler = TokenUsageCallbackHandler()
    handler.on_llm_end(_chat_result(11, 5))

    assert handler.prompt_tokens == 11
    assert handler.completion_tokens == 5
    assert handler.total_tokens == 16
    assert handler.successful_requests == 1


def test_falls_back_to_the_llm_output_token_usage_block():
    handler = TokenUsageCallbackHandler()
    handler.on_llm_end(_llm_output_result(7, 3))

    assert handler.prompt_tokens == 7
    assert handler.completion_tokens == 3
    assert handler.total_tokens == 10


def test_sums_across_every_call_in_the_block():
    handler = TokenUsageCallbackHandler()
    handler.on_llm_end(_chat_result(10, 2))
    handler.on_llm_end(_llm_output_result(5, 1))

    assert handler.prompt_tokens == 15
    assert handler.completion_tokens == 3
    assert handler.successful_requests == 2


def test_a_response_without_usage_does_not_raise():
    handler = TokenUsageCallbackHandler()
    handler.on_llm_end(LLMResult(generations=[[Generation(text="hello")]]))

    assert handler.prompt_tokens == 0
    assert handler.completion_tokens == 0
    assert handler.successful_requests == 1


def test_the_context_manager_exposes_the_handler_and_clears_it_afterwards():
    with get_token_usage_callback() as cb:
        assert token_usage_callback_var.get() is cb
        cb.on_llm_end(_chat_result(4, 6))
        assert cb.prompt_tokens == 4
        assert cb.completion_tokens == 6

    assert token_usage_callback_var.get() is None


def test_the_context_var_is_cleared_even_when_the_block_raises():
    try:
        with get_token_usage_callback():
            raise RuntimeError("boom")
    except RuntimeError:
        pass

    assert token_usage_callback_var.get() is None


def test_the_handler_attaches_itself_to_langchain_calls_in_the_block():
    """The counters are never passed to the model explicitly.

    `capture_cost` wraps evaluator code that calls the LLM through ragas, so the
    handler has to attach itself through the langchain callback configure hook.
    """
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    reply = AIMessage(
        content="pong",
        usage_metadata={"input_tokens": 12, "output_tokens": 4, "total_tokens": 16},
    )
    llm = GenericFakeChatModel(messages=iter([reply, reply]))

    with get_token_usage_callback() as cb:
        llm.invoke("ping")
        llm.invoke("ping")

    assert cb.successful_requests == 2
    assert cb.prompt_tokens == 24
    assert cb.completion_tokens == 8
