from dotenv import load_dotenv
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

load_dotenv()

from fastapi import FastAPI
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()

import langwatch

app = FastAPI()


class EndpointParams(BaseModel):
    input: str


class CompletionStreaming:
    @langwatch.trace(name="fastapi_sample_endpoint")
    async def execute(self, input: str):
        langwatch.get_current_trace().autotrack_openai_calls(client)
        langwatch.get_current_trace().update(
            metadata={"label": "fastapi"},
        )

        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
                },
                {"role": "user", "content": input},
            ],
            stream=True,
        )

        for chunk in completion:
            content = chunk.choices[0].delta.content
            if content is not None:
                yield content


@app.post("/")
async def fastapi_sample_endpoint(params: EndpointParams):
    return StreamingResponse(CompletionStreaming().execute(params.input))  # type: ignore


def call_fastapi_sample_endpoint(input: str) -> str:
    test_client = TestClient(app)
    response = test_client.post("/", json={"input": input})

    return response.text


if __name__ == "__main__":
    import uvicorn
    import os

    # Test one llm call before starting the server
    print(call_fastapi_sample_endpoint("Hello, world!"))

    port = int(os.environ.get("PORT", 9000))
    uvicorn.run(app, host="0.0.0.0", port=port)
