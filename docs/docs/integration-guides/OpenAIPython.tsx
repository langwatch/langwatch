import { MetadataFootnote } from "./utils/MetadataFootnote";
import { RenderCode } from "./utils/RenderCode";
import { langwatchEndpointEnv } from "./utils/langwatchEndpointEnv";

export const OpenAIPython = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Installation:</h3>
      <RenderCode code={`pip install langwatch`} language="bash" />
      <h3>Configuration:</h3>
      <p>
        Ensure the <code>LANGWATCH_API_KEY</code> environment variable is set:
      </p>
      <RenderCode
        code={`${langwatchEndpointEnv()}export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        Use the <code>OpenAITracer</code> context manager, passing the OpenAI
        instance to it to automatically trace all interactions within its block
      </p>
      <RenderCode
        code={`import langwatch.openai
from openai import OpenAI

client = OpenAI()

# Use the LangWatch tracer for the OpenAI model
with langwatch.openai.OpenAITracer(
  client,
  metadata={
      "user_id": "optional-user-123",
      "thread_id": "optional-thread-456",
  },
):
    # Your interaction with OpenAI's API
    completion = client.chat.completions.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Tell me a joke about elephants."},
        ]
    )
`}
        language="python"
      />
      <p>
        This will trace all spans within the block. Spans are created for each
        API call made to OpenAI during the lifecycle of a trace.
      </p>
      <MetadataFootnote />
    </div>
  );
};
