---
title: Getting Started
sidebar_position: 2
---

# Getting Started with LangWatch

Welcome to LangWatch! In this section, we'll guide you through the initial steps needed to integrate LangWatch into your projects. Whether you're using OpenAI or Langchain to power your LLMs, setting up LangWatch is straightforward and requires minimal changes to your existing code.

## Prerequisites

Before we get started, make sure you have the following:

- An LLM provider, like OpenAI or Langchain, integrated into your application.
- The `langwatch` Python library installed. If you haven't installed it yet, you can do so with the following pip command:

```sh
pip install langwatch
```

- Your `LANGWATCH_API_KEY` set as an environment variable. You can find this in your [LangWatch dashboard](https://app.langwatch.ai) after setting up your project.

## Setting Your Environment Variable

LangWatch uses an API key for authentication. Set your `LANGWATCH_API_KEY` environment variable which you obtained from your LangWatch dashboard. You can set this in your shell or directly in your application.

For example, in your terminal, you could set the environment variable like this:

```sh
export LANGWATCH_API_KEY='your_api_key_here'
```

Ensure that this environment variable is set before you run your application so that LangWatch can authenticate your requests.

## Integrating with OpenAI

LangWatch provides an easy-to-use tracer for OpenAI's API. To start capturing data, wrap your API calls with `OpenAITracer`. Here's a quick example:

```python
# highlight-next-line
import langwatch.openai
from openai import OpenAI

client = OpenAI()
import openai

# Use the LangWatch tracer for the OpenAI model
# highlight-next-line
with langwatch.openai.OpenAITracer(client):
    # Your interaction with OpenAI's API
    completion = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {
                "role": "user",
                "content": "Tell me a joke!"
            }
        ]
    )

    for message in completion['messages']:
        if message['role'] == 'assistant':
            print(message['content'])
```

The tracer will capture all the pertinent data during its context's lifetime, automatically associating the data with the API key set in your environment.

## Metadata

For a more granular analysis, LangWatch allows you to specify metadata such as `user_id` and `thread_id`. This way, you can track interactions per user or conversation threads.

```python
with langwatch.openai.OpenAITracer(client, metadata={"user_id": "user-123", "thread_id": "thread-456"}):
    # Your OpenAI LLM API calls here
```

- `user_id` should uniquely identify the end-user of your application.
- `thread_id` is useful for grouping a series of related interactions, like a chat session.
- `labels` generic strings to tag your messages in any way you prefer, can also be used for versioning.
- `customer_id` identifying your customer building on top of your platform

Read more about those metadata keys on our [concepts](./concepts) page.

## Langchain Integration

If you're using Langchain, you can integrate LangWatch in a similar fashion using `LangChainTracer`, but you have to pass `langWatchCallback` as a `callback` of the chain, which will capture all the steps going on inside your chain:

```python
import langwatch.langchain
from langchain.llms import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

model = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("tell me a joke about {topic}")
chain = prompt | model

with langwatch.langchain.LangChainTracer() as langWatchCallback:
    result = chain.invoke(
        {"topic": "bears"}, config={"callbacks": [langWatchCallback]}
    )

    print(result)
```

## Visualize

Now all your messages should be visible on your [LangWatch Dashboard](https://app.langwatch.ai), open it up to explore:

![langwatch dashboard](@site/static/img/screenshot-messages.png)

## What's Next?

Now that you have integrated LangWatch, it will start capturing traces from your LLM interactions. You're all set to explore the insights and analytics provided by LangWatch. From here, you might want to:

- Visit the [Trace Analysis](#) page to see how you can examine and make sense of your LLM interactions.
- Learn more about [LLM Checks](#) and understand the automated evaluations performed by LangWatch.
- Check out [Advanced Configurations](#) for details on customizing your LangWatch setup.

If you encounter any hurdles or have questions, our support team is eager to assist you. Welcome aboard, and happy tracing!
