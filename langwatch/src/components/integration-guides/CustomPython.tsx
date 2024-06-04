import { MetadataFootnote } from "./utils/MetadataFootnote";
import { RenderCode } from "./utils/RenderCode";
import { langwatchEndpointEnv } from "./utils/langwatchEndpointEnv";

export const CustomPython = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Installation:</h3>
      <RenderCode code={`pip install langwatch`} language="bash" />
      <h3>Configuration:</h3>
      <p>
        Ensure the <code>LANGWATCH_API_KEY</code> environment variable is set:
      </p>
      <RenderCode
        code={`${langwatchEndpointEnv()}export LANGWATCH_API_KEY='${
          apiKey ?? "your_api_key_here"
        }'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        First wrap your LLM call with the <code>BaseContextTracer</code> to
        guarantee trace collection in the background at the end of the block:
      </p>
      <RenderCode
        code={`import langwatch.tracer
from langwatch.types import LLMSpan

with langwatch.tracer.BaseContextTracer(
  trace_id=nanoid.generate(), metadata={
    "user_id": "optional-user-123",
    "thread_id": "optional-thread-456",
  }
) as tracer:
  # Your LLM call here
`}
        language="python"
      />
      <p>
        Then, you will have to capture the timestamps, the inputs and outputs,
        and create one or more spans using <code>tracer.append_span()</code>.
      </p>
      <RenderCode
        code={`import langwatch.tracer
from langwatch.types import LLMSpan

with langwatch.tracer.BaseContextTracer(
  trace_id=nanoid.generate(), metadata={
    "user_id": "optional-user-123",
    "thread_id": "optional-thread-456",
  }
) as tracer:
  started_at_ts = int(time.time() * 1000)  # time must be in milliseconds

  time.sleep(1)  # generating the message...

  generated_message = "Hello there! How can I help?"

  tracer.append_span(
      LLMSpan(
          type="llm",
          span_id=nanoid.generate(),
          model="llama2",
          input={
              "type": "chat_messages",
              "value": [
                  {"role": "user", "content": message.content},
              ],
          },
          outputs=[
              {
                  "type": "chat_messages",
                  "value": [
                      {
                          "role": "assistant",
                          "content": generated_message,
                      }
                  ],
              }
          ],
          timestamps={
              "started_at": started_at_ts,
              "finished_at": int(time.time() * 1000),
          },
      )
  )
`}
        language="python"
      />
      <MetadataFootnote />
    </div>
  );
};
