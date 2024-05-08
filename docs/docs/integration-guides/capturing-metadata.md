---
sidebar_position: 30
title: Capturing additional spans and metadata
---

# Capturing additional spans and metadata

By using LangWatch integrations, all the calls to LLMs should be automatically captured, and by using the [RAG context tracking](../rag/capture_rag), you can pass in also the context. However, sometimes it might be useful to add a new piece of metadata that you only figure out in the middle of your LLM pipeline, for example, tagging it with a new label. You can do that by exposing the tracer in the context manager, and appending new metadata. For example, for the OpenAI tracer:

```python
import langwatch.openai
from openai import OpenAI

client = OpenAI()

with langwatch.openai.OpenAITracer(
  client,
  metadata={
      "user_id": "optional-user-123",
      "thread_id": "optional-thread-456",
      # Initialize labels as empty
      "labels": []
  },
) as tracer:
    completion = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Tell me a joke about elephants."},
        ]
    )
    # Append the label after calling the LLM
    tracer.metadata["labels"] += ["joke"]
```

And here is an example if you are using LangChain tracer:

```python
import langwatch.langchain
from langchain.llms import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

# Create your LangChain
model = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("tell me a joke about {topic}")
chain = prompt | model

# Use the tracer context manager
with langwatch.langchain.LangChainTracer(
  metadata={
    "user_id": "optional-user-123",
    "thread_id": "optional-thread-456",
    #  Initialize labels as empty
    "labels": []
  }
) as langWatchCallback:
    result = chain.invoke(
        {"topic": "bears"},
        config={"callbacks": [langWatchCallback]}
    )
    # Append the label after calling the LLM
    tracer.metadata["labels"] += ["joke"]
```

# Appending new spans

You can also append new spans other than the ones automatically captured by LangWatch tracer, take a look on `tracer.append_span` on the [Custom Python Integration](./custom-python).