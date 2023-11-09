---
sidebar_position: 3
title: Custom REST
---

# REST Endpoint Integration

If your preferred programming language or platform is not directly supported by the existing LangWatch libraries, you can use the REST API with `curl` to send trace data. This guide will walk you through how to integrate LangWatch with any system that allows HTTP requests.

### Prerequisites:

- Ensure you have `curl` installed on your system.
- Obtain your `LANGWATCH_API_KEY` from the LangWatch dashboard.

### Configuration:

Set the `LANGWATCH_API_KEY` environment variable in your environment:

```bash
export LANGWATCH_API_KEY='your_api_key_here'
```

### Usage:

You will need to prepare your span data in accordance with the Span type definitions provided by LangWatch. Below is an example of how to send span data using `curl`:

1. Prepare your JSON data. Make sure it's properly formatted as expected by LangWatch.

2. Use the `curl` command to send your trace data. Here is a basic template:

```bash
# Set your API key and endpoint URL
API_KEY="your_langwatch_api_key"
ENDPOINT="https://app.langwatch.ai/api/collector"

# Use curl to send the POST request, e.g.:
curl -X POST "$ENDPOINT" \
     -H "X-Auth-Token: $API_KEY" \
     -H "Content-Type: application/json" \
     -d @- <<EOF
{
  "spans": [
    {
      "type": "llm",
      "id": "span-123",
      "trace_id": "trace-456",
      "vendor": "openai",
      "model": "gpt-4",
      "input": {
        "type": "text",
        "value": "Input text for the LLM"
      },
      "outputs": [
        {
          "type": "text",
          "value": "Output from the LLM"
        }
      ],
      "params": {
        "temperature": 0.7,
        "stream": false
      },
      "metrics": {
        "prompt_tokens": 100,
        "completion_tokens": 150
      },
      "timestamps": {
        "started_at": 1617981376,
        "finished_at": 1617981378
      }
    }
  ],
  "user_id": "your_user_identifier",
  "thread_id": "your_thread_identifier"
}
EOF
```

Replace the placeholders with your actual data. The `@-` tells `curl` to read the JSON data from the standard input, which we provide via the `EOF`-delimited here-document.

<!-- TODO: replace with a sdk reference link for the type -->
For the type reference of how a `span`` should look like, check out our [types definitions](https://github.com/langwatch/langwatch/blob/main/python-sdk/langwatch/types.py#L73)

3. Execute the `curl` command. If successful, LangWatch will process your trace data.

This method of integration offers a flexible approach for sending traces from any system capable of making HTTP requests. Whether you're using a less common programming language or a custom-built platform, this RESTful approach ensures you can benefit from LangWatch's capabilities.

Remember to handle errors and retries as needed, similar to the retry logic shown in the Python example. You might need to script additional logic around the `curl` command to handle these cases.
