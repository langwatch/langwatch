---
sidebar_position: 2
title: LangChain Python Integration
---

# LangChain Python Integration

To track the interactions with LangChain, use the `LangChainTracer`.

### Prerequisites:

- Install the `langwatch` library via pip.
- Obtain your `LANGWATCH_API_KEY` from the LangWatch dashboard.

### Installation:

```bash
pip install langwatch
```

### Configuration:

Ensure the `LANGWATCH_API_KEY` environment variable is set:

```bash
export LANGWATCH_API_KEY='your_api_key_here'
```

### Usage:

Wrap your LangChain interactions with `LangChainTracer`.

```python
import langwatch
from langchain.llms import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

# Create your LangChain
model = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("tell me a joke about {topic}")
chain = prompt | model

# Use the tracer context manager
with langwatch.langchain.LangChainTracer(user_id="user-123", thread_id="thread-456") as tracer:
    # Invoke LangChain with LangWatch callbacks
    result = chain.invoke(
        {"topic": "bears"},
        config={"callbacks": [tracer]}
    )
```

Each step in LangChain (`chain`) that invokes an LLM call will be traced as an individual span within a trace.

For both integrations, it's crucial to pass the `user_id` if you want to leverage user-specific analytics and the `thread_id` to group related traces together.

After following the above guides, your interactions with LLMs should now be captured by LangWatch. Once integrated, you can visit your LangWatch dashboard to view and analyze the traces collected from your applications.
