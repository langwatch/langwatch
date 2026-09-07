from typing import List
from dotenv import load_dotenv

from langwatch.types import RAGChunk

load_dotenv()

import chainlit as cl

from haystack import Pipeline, Document, component
from haystack.utils import Secret
from haystack.document_stores.in_memory import InMemoryDocumentStore
from haystack.components.retrievers.in_memory import InMemoryBM25Retriever
from haystack.components.generators.chat import OpenAIChatGenerator
from haystack.components.builders import ChatPromptBuilder
from haystack.dataclasses import ChatMessage

import os
import langwatch


# Haystack pipeline

# Write documents to InMemoryDocumentStore
document_store = InMemoryDocumentStore()
document_store.write_documents(
    [
        Document(content="My name is Jean and I live in Paris."),
        Document(content="My name is Mark and I live in Berlin."),
        Document(content="My name is Giorgio and I live in Rome."),
    ]
)

# Build a RAG pipeline
prompt_template = """
Given these documents, answer the question.
Documents:
{% for doc in documents %}
    {{ doc.content }}
{% endfor %}
Question: {{question}}
Answer:
"""


class TrackedInMemoryBM25Retriever(InMemoryBM25Retriever):
    @langwatch.span(type="rag")
    @component.output_types(documents=List[Document])
    def run(self, query: str, **kwargs):
        results = super().run(query, **kwargs)
        langwatch.get_current_span().update(
            contexts=[
                RAGChunk(
                    document_id=document.id,
                    content=document.content or "",
                )
                for document in results["documents"]
            ]
        )
        return results

    @component.output_types(documents=List[Document])
    async def run_async(self, query: str, **kwargs):
        return self.run(query, **kwargs)


retriever = TrackedInMemoryBM25Retriever(document_store=document_store)


class TrackedChatPromptBuilder(ChatPromptBuilder):
    @langwatch.span()
    @component.output_types(prompt=List[ChatMessage])
    def run(self, template=None, template_variables=None, **kwargs):
        return super().run(template, template_variables, **kwargs)

    @component.output_types(prompt=List[ChatMessage])
    async def run_async(self, template=None, template_variables=None, **kwargs):
        return self.run(template, template_variables, **kwargs)


prompt_builder = TrackedChatPromptBuilder(
    template=[ChatMessage.from_user(prompt_template)]
)


class TrackedOpenAIChatGenerator(OpenAIChatGenerator):
    @langwatch.span(type="llm")
    def run(self, messages: List[ChatMessage], **kwargs):
        result = super().run(messages, **kwargs)
        reply = result["replies"][0]
        usage = reply.meta.get("usage", {})
        langwatch.get_current_span().update(
            model=self.model,
            output=reply.text,
            metrics={
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
            },
        )
        return result

    async def run_async(self, messages: List[ChatMessage], **kwargs):
        return self.run(messages, **kwargs)


llm = TrackedOpenAIChatGenerator(
    api_key=Secret.from_token(os.environ["OPENAI_API_KEY"]), model="gpt-5-mini"
)

rag_pipeline = Pipeline()
rag_pipeline.add_component("retriever", retriever)
rag_pipeline.add_component("prompt_builder", prompt_builder)
rag_pipeline.add_component("llm", llm)
rag_pipeline.connect("retriever", "prompt_builder.documents")
rag_pipeline.connect("prompt_builder.prompt", "llm.messages")


@cl.on_message
@langwatch.trace()
async def main(message: cl.Message):
    langwatch.get_current_trace().update(
        metadata={"labels": ["haystack", "rag"]},
    )

    msg = cl.Message(
        content="",
    )

    langwatch.get_current_trace().update(
        metadata={
            "thread_id": message.thread_id,
            "user_id": "my-test-user",
            "tags": ["User relevant question", "Second tag example"],
            "metadata": {"foo": "bar"},
        }
    )

    results = rag_pipeline.run(
        {
            "retriever": {"query": message.content},
            "prompt_builder": {"question": message.content},
        }
    )

    msg.content = results["llm"]["replies"][0].text
    await msg.send()
