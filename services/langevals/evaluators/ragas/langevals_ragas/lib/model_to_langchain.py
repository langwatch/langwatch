from typing import List, Optional, cast
from langchain_openai import (
    ChatOpenAI,
    OpenAIEmbeddings,
)
from langchain_core.language_models.chat_models import (
    BaseChatModel,
)

import litellm


class LitellmCompletion:
    exception: Optional[Exception] = None
    temperature: float = 0

    def __init__(
        self,
        temperature: float = 0,
        extra_call_kwargs: Optional[dict] = None,
    ):
        self.temperature = temperature
        # Call arguments the evaluator pins for every call made through this
        # client, e.g. the azure api_version that used to be set through the
        # process environment.
        self.extra_call_kwargs = extra_call_kwargs or {}

    def create(self, *args, **kwargs):
        try:
            if self.temperature:
                kwargs["temperature"] = self.temperature
            kwargs["drop_params"] = True
            kwargs.update(self.extra_call_kwargs)
            return litellm.completion(*args, **kwargs)
        except Exception as e:
            self.exception = e
            raise e


class AsyncLitellmCompletion(LitellmCompletion):
    async def create(self, *args, **kwargs):
        return super().create(*args, **kwargs)


def model_to_langchain(
    model: str,
    temperature: float = 0,
    extra_call_kwargs: Optional[dict] = None,
) -> BaseChatModel:
    if model.startswith("claude-"):
        model = model.replace("claude-", "anthropic/claude-")

    if "gpt-5" in model:
        temperature = 1.0

    return ChatOpenAI(
        model=model,
        api_key="dummy",  # type: ignore
        temperature=temperature or 0,
        client=LitellmCompletion(
            temperature=temperature, extra_call_kwargs=extra_call_kwargs
        ),
        async_client=AsyncLitellmCompletion(
            temperature=temperature, extra_call_kwargs=extra_call_kwargs
        ),
    )


class LitellmEmbeddings:
    exception: Optional[Exception] = None

    def __init__(self, extra_call_kwargs: Optional[dict] = None):
        self.extra_call_kwargs = extra_call_kwargs or {}

    def create(self, *args, **kwargs):
        try:
            kwargs.update(self.extra_call_kwargs)
            result = litellm.embedding(*args, **kwargs)
            return result.model_dump()
        except Exception as e:
            self.exception = e
            raise e


class LitellmEmbeddingsWrapper(OpenAIEmbeddings):
    def embed_query(self, question: str):
        return self.client.create(model=self.model, input=question)["data"][0][
            "embedding"
        ]

    def _tokenize(self, texts: List[str], chunk_size: int):
        _iter, tokens, indices = super()._tokenize(texts, chunk_size)

        model_name = self.tiktoken_model_name or self.model
        import tiktoken

        try:
            encoding = tiktoken.encoding_for_model(model_name)
        except KeyError:
            encoding = tiktoken.get_encoding("cl100k_base")

        decoded_tokens = [encoding.decode(cast(List[int], token)) for token in tokens]

        return _iter, decoded_tokens, indices

    async def aembed_query(self, question: str):
        return self.embed_query(question)


def embeddings_model_to_langchain(
    embeddings_model: str,
    extra_call_kwargs: Optional[dict] = None,
):
    return LitellmEmbeddingsWrapper(
        model=embeddings_model,
        api_key="dummy",  # type: ignore
        client=LitellmEmbeddings(extra_call_kwargs=extra_call_kwargs),
    )
