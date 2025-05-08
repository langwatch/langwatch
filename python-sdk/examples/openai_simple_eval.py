from dotenv import load_dotenv
load_dotenv()

from openai import OpenAI
import asyncio
import langwatch

client = OpenAI()
langwatch.setup()


@langwatch.trace()
async def main():
    langwatch.get_current_trace().autotrack_openai_calls(client)

    await run()


@langwatch.span(name="run")
async def run():
    message = "How do I edit my password on my account?"
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are the assistant bot for a company that sends emails to customers. You are given a question and you need to answer it in a way that is helpful and informative.",
            },
            {"role": "user", "content": message},
        ],
        stream=True,
        stream_options={"include_usage": True},
    )

    text = ""
    for part in completion:
        if len(part.choices) == 0:
            continue
        if token := part.choices[0].delta.content or "":
            text += token

    result = langwatch.get_current_span().evaluate(
        "custom/workflow_MoMAq3MKwJLvYz96GyyZj",
        name="Example SDK Evaluation",
        data={
            "question": message,
            "answer": text,
        },
    )

    print(text)
    print(result)

if __name__ == "__main__":
    asyncio.run(main())
