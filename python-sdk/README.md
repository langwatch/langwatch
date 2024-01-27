# LangWatch Python SDK

Go to [https://langwatch.ai](https://langwatch.ai) to setup your account.

To trace OpenAI calls:

```diff
from openai import OpenAI
+ import langwatch.openai

client = OpenAI()

+ with langwatch.openai.OpenAITracer(client):
    completion = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": message},
        ],
        stream=True,
    )
```

To trace LangChain agent:

```diff
+ import langwatch.langchain

  # ...

  chain = LLMChain(
      llm=ChatOpenAI(),
      prompt=chat_prompt,
      output_parser=CommaSeparatedListOutputParser(),
  )
+ with langwatch.langchain.LangChainTracer() as langWatchCallback:
-   result = chain.run(text="colors")
+   result = chain.run(text="colors", callbacks=[langWatchCallback])
```