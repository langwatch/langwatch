---
sidebar_position: 1
---

# OpenAI Python Integration

To integrate LangWatch with OpenAI's GPT models using Python, follow these steps:

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

Use the `OpenAITracer` context manager to automatically trace all interactions within its block.

```python
import langwatch
import openai

# Set up the tracer context manager
with langwatch.openai.OpenAITracer(user_id="user-123", thread_id="thread-456"):
    # Your interaction with OpenAI's API
    completion = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Tell me a joke about elephants."},
        ]
    )
```

This will trace all spans within the block. Spans are created for each API call made to OpenAI during the lifecycle of a trace.
