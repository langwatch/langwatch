import asyncio
from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

from openai import OpenAI
import langwatch

client = OpenAI()
langwatch.setup()


@langwatch.trace()
async def main():
    langwatch.get_current_trace().autotrack_openai_calls(client)

    await run()


@langwatch.span(name="run")
async def run():
    message = "Which album does Taylor Swift sing about Tim McGraw?"
    completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
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
        "azure/content_safety",
        name="Draft Evaluation (1)",
        data={
            "input": message,
            "output": text,
        },
    )

    print(text)
    print(result)

if __name__ == "__main__":
    asyncio.run(main())
