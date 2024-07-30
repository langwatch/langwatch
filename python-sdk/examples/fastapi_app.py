from dotenv import load_dotenv
from fastapi.testclient import TestClient

load_dotenv()

from fastapi import FastAPI
from openai import OpenAI
from pydantic import BaseModel

client = OpenAI()

import sys

sys.path.append("..")
import langwatch

langwatch.debug = True

app = FastAPI()


class EndpointParams(BaseModel):
    input: str


@app.post("/")
@langwatch.trace(name="fastapi_sample_endpoint")
def fastapi_sample_endpoint(params: EndpointParams):
    langwatch.get_current_trace().autotrack_openai_calls(client)

    completion = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
            },
            {"role": "user", "content": params.input},
        ],
    )

    return completion.choices[0].message.content


if __name__ == "__main__":
    import uvicorn
    import os

    # Create a test client
    test_client = TestClient(app)

    def call_fastapi_sample_endpoint(input: str) -> str:
        # Create a mock request
        response = test_client.post("/", json={"input": input})

        return response.json()

    print(call_fastapi_sample_endpoint("Hello, world!"))

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
