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
  trace_id=nanoid.generate(), metadata={}
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
  trace_id=nanoid.generate(), metadata={}
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
      <p>
        It's optional but highly recommended to pass the <code>user_id</code> if
        you want to leverage user-specific analytics and the{" "}
        <code>thread_id</code> to group related traces together. To connect it
        to an event later on. Read more about those and other concepts{" "}
        <a href="https://docs.langwatch.ai/docs/concepts" target="_blank">
          here
        </a>
        .
      </p>
    </div>
  );
};
