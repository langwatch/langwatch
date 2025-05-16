# This example uses the OpenTelemetry instrumentation for OpenAI from OpenInference: https://pypi.org/project/openinference-instrumentation-openai/

from dotenv import load_dotenv

import langwatch

load_dotenv()

import chainlit as cl

from haystack import Pipeline, Document
from haystack.utils import Secret
from haystack.document_stores.in_memory import InMemoryDocumentStore
from haystack.components.retrievers.in_memory import InMemoryBM25Retriever
from haystack.components.generators import OpenAIGenerator
from haystack.components.builders.answer_builder import AnswerBuilder
from haystack.components.builders.prompt_builder import PromptBuilder

import os
from openinference.instrumentation.haystack import HaystackInstrumentor
from openinference.instrumentation import using_attributes

langwatch.setup(
    instrumentors=[HaystackInstrumentor()],
)

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

retriever = InMemoryBM25Retriever(document_store=document_store)
prompt_builder = PromptBuilder(template=prompt_template)
llm = OpenAIGenerator(
    api_key=Secret.from_token(os.environ["OPENAI_API_KEY"]), model="gpt-4o-mini"
)

rag_pipeline = Pipeline()
rag_pipeline.add_component("retriever", retriever)
rag_pipeline.add_component("prompt_builder", prompt_builder)
rag_pipeline.add_component("llm", llm)
rag_pipeline.connect("retriever", "prompt_builder.documents")
rag_pipeline.connect("prompt_builder", "llm")


@cl.on_message
async def main(message: cl.Message):
    msg = cl.Message(
        content="",
    )

    with using_attributes(
        session_id=message.thread_id,
        user_id="my-test-user",
        tags=["User relevant question", "Second tag example"],
        metadata={"foo": "bar"},
    ):
        results = rag_pipeline.run(
            {
                "retriever": {"query": message.content},
                "prompt_builder": {"question": message.content},
            }
        )

    msg.content = results["llm"]["replies"][0]
    await msg.send()
