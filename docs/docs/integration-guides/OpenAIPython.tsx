import { RenderCode } from "./utils/RenderCode";

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
        code={`export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        Use the <code>OpenAITracer</code> context manager to automatically trace
        all interactions within its block.
      </p>
      <RenderCode
        code={`import langwatch.openai
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
`}
        language="python"
      />
      <p>
        This will trace all spans within the block. Spans are created for each
        API call made to OpenAI during the lifecycle of a trace.
      </p>
    </div>
  );
};
