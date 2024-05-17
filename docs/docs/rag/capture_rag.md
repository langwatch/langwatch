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
<TabItem value="langchain" label="LangChain">
When using LangChain, generally your RAG happens by calling a [`Retriever`](https://python.langchain.com/v0.1/docs/modules/data_connection/retrievers/).

We provide a utility `langwatch.langchain.capture_rag_from_retriever` to capture the documents found by the retriever and convert it into a LangWatch compatible format for tracking. For that you need to pass the retriever as first argument, and then a function to map each document to a `RAGChunk`, like in the example below:

```python
import langwatch.langchain
from langwatch.types import RAGChunk

  with langwatch.langchain.LangChainTracer() as langWatchCallback:
    retriever_tool = create_retriever_tool(
        # highlight-start
        langwatch.langchain.capture_rag_from_retriever(
            retriever,
            lambda document: RAGChunk(
                document_id=document.metadata["source"],
                content=document.page_content
            ),
        ),
        # highlight-end
        "langwatch_search",
        "Search for information about LangWatch. For any questions about LangWatch, use this tool if you didn't already",
    )

    tools = [retriever_tool]
    model = ChatOpenAI(streaming=True)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis and use tools only once.\n\n{agent_scratchpad}",
            ),
            ("human", "{question}"),
        ]
    )
    agent = create_tool_calling_agent(model, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
    return executor.invoke(user_input, config=RunnableConfig(
        callbacks=[langWatchCallback]
    ))
```

Alternatively, if you don't use retrievers, but still want to capture the context for example from a tool call that you do, we also provide a utility `langwatch.langchain.capture_rag_from_tool` to capture RAG contexts around a tool. For that you need to pass the tool as first argument, and then a function to map the tool's output to `RAGChunk`s, like in the example below:

```python
import langwatch.langchain
from langwatch.types import RAGChunk

  with langwatch.langchain.LangChainTracer() as langWatchCallback:
    # highlight-start
    wrapped_tool = langwatch.langchain.capture_rag_from_tool(
        my_custom_tool, lambda response: [
          RAGChunk(
            document_id=response["id"], # optional
            chunk_id=response["chunk_id"], # optional
            content=response["content"]
          )
        ]
    )

    tools = [wrapped_tool] # use the new wrapped tool in your agent instead of the original one
    # highlight-end
    model = ChatOpenAI(streaming=True)
    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis and use tools only once.\n\n{agent_scratchpad}",
            ),
            ("human", "{question}"),
        ]
    )
    agent = create_tool_calling_agent(model, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)
    return executor.invoke(user_input, config=RunnableConfig(
        callbacks=[langWatchCallback]
    ))
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

Here is what each of the keys mean:

`input`: The initial user input or query. If not specified, the `input` will be automatically extracted as the last user message to the LLM.

`contexts`: A list of the retrieved content that will be used for the LLM generation

- `document_id`: A unique identified of the where this content originally comes from, can identify a document but also an id for an API call. Optional but highly recommended to track your documents, if not set an automatic ID will be generated for it based on the md5 hashing of the content.

- `chunk_id`: Optional. If you are splitting content into chunks, you may identify as well which chunk specifically this content is from

- `content`: Any JSON or string. This is the actual content that will be sent to the LLM, if a JSON is passed, only the string fields of the JSON will be used for Guardrails and Evaluations

The outputs of the last LLM call inside the RAG will automatically be considered as the outputs of the RAG as well, if this is not expected, then you need to manually specify the `outputs` field on the RAG capture too.
