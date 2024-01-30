---
title: RAGs Context Tracking
sidebar_position: 5
---

# RAGs Context Tracking

Retrieval Augmented Generation (RAGs) is a common way to augment the generation of your LLM by retrieving a set of documents based on the user query and giving it to the LLM to use as context for answering, either by using a vector database, getting responses from an API, or integrated agent files and memory.

It can be challenging, however, to build a good quality RAG pipeline, making sure the right data was retrieved, preventing the LLM from hallucinating, monitor which documents are the most used and keep iterating to improve it, this is where integrating with LangWatch can help, by integrating your RAG you unlock a series of Guardrails, Measurements and Analytics for RAGs LangWatch.

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
<TabItem value="python" label="Python">
To track the RAG context, simply add `with langwatch.capture_rag` around the LLM call:

```python
with langwatch.openai.OpenAIChatCompletionTracer(client):
  # highlight-start
  with langwatch.capture_rag(
      input="What is the capital of France?",
      contexts=[
          {
              "document_id": "doc-1",
              "chunk_id": "0",
              "content": "France is a country in Europe.",
          },
          {
              "document_id": "doc-2",
              "chunk_id": "0",
              "content": "Paris is the capital of France.",
          },
      ],
  ):
  # highlight-end
      response = client.chat.completions.create(
          model="gpt-3.5-turbo",
          messages=[
              {"role": "user", "content": "What is the capital of France?"}
          ],
      )
```

</TabItem>
<TabItem value="rest" label="REST API">
To track the RAG context when using the REST API, add a new span of type `rag`, you may also refer the LLM generation as the child of it:

```bash
curl -X POST "https://app.langwatch.ai/api/collector" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "trace_id": "trace-123",
  "spans": [
    # highlight-start
    {
      "type": "rag",
      "name": null,
      "span_id": "span-123",
      "input": {
          "type": "text",
          "value": "What is the capital of France?"
      },
      "timestamps": {
          "started_at": 1702485035000,
          "first_token_at": null,
          "finished_at": 1702485041000
      },
      "contexts": [
        {
            "document_id": "doc-1",
            "chunk_id": "0",
            "content": "France is a country in Europe.",
        },
        {
            "document_id": "doc-2",
            "chunk_id": "0",
            "content": "Paris is the capital of France.",
        },
      ]
    },
    # highlight-end
    {
      "type": "llm",
      "span_id": "span-456",
      # highlight-next-line
      "parent_id": "span-123",
      "vendor": "openai",
      "model": "gpt-4",
      "input": {
        "type": "chat_messages",
        "value": [
          {
            "role": "user",
            "content": "Input to the LLM"
          }
        ]
      },
      "outputs": [
        {
          "type": "chat_messages",
          "value": [
              {
                  "role": "assistant",
                  "content": "Output from the LLM",
                  "function_call": null,
                  "tool_calls": []
              }
          ]
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
        "started_at": 1617981376000,
        "finished_at": 1617981378000
      }
    }
  ],
}
EOF`
```

</TabItem>
</Tabs>

`input`: The initial user input or query. If not specified, the `input` will be automatically extracted as the last user message to the LLM.

`contexts`: A list of the retrieved content that will be used for the LLM generation

- `document_id`: A unique identified of the where this content originally comes from, can identify a document but also an id for an API call

- `chunk_id`: Optional. If you are splitting content into chunks, you may identify as well which chunk specifically this content is from

- `content`: Any JSON or string. This is the actual content that will be sent to the LLM, if a JSON is passed, only the string fields of the JSON will be used for Guardrails and Evaluations

The outputs of the last LLM call inside the RAG will automatically be considered as the outputs of the RAG as well, if this is not expected, then you need to manually specify the `outputs` field on the RAG capture too.
