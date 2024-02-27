import { RenderCode } from "./utils/RenderCode";
import { langwatchEndpointEnv } from "./utils/langwatchEndpointEnv";

export const CustomRest = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Prerequisites:</h3>
      <ul>
        <li>
          Ensure you have <code>curl</code> installed on your system.
        </li>
      </ul>
      <h3>Configuration:</h3>
      <p>
        Set the <code>LANGWATCH_API_KEY</code> environment variable in your
        environment:
      </p>
      <RenderCode
        code={`${langwatchEndpointEnv()}export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        You will need to prepare your span data in accordance with the Span type
        definitions provided by LangWatch. Below is an example of how to send
        span data using <code>curl</code>:
      </p>
      <ol>
        <li>
          Prepare your JSON data. Make sure it's properly formatted as expected
          by LangWatch.
        </li>
        <li>
          Use the <code>curl</code> command to send your trace data. Here is a
          basic template:
        </li>
      </ol>
      <RenderCode
        code={`# Set your API key and endpoint URL
API_KEY="${apiKey ?? "your_langwatch_api_key"}"
ENDPOINT="https://app.langwatch.ai/api/collector"

# Use curl to send the POST request, e.g.:
curl -X POST "$ENDPOINT" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
{
  "trace_id": "trace-123",
  "spans": [
    {
      "type": "llm",
      "span_id": "span-456",
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
        "started_at": 1706628806000,
        "finished_at": 1706628808000
      }
    }
  ],
  "metadata": {
    "user_id": "optional_end_user_identifier",
    "thread_id": "optional_thread_identifier",
    "customer_id": "optional_platform_customer_identifier",
    "labels": ["optional_label_1", "optional_label_2"]
  }
}
EOF`}
        language="bash"
      />
      <p>
        Replace the placeholders with your actual data. The <code>@-</code>{" "}
        tells <code>curl</code> to read the JSON data from the standard input,
        which we provide via the <code>EOF</code>-delimited here-document.
      </p>
      <p>
        For the type reference of how a <code>span</code> should look like,
        check out our{" "}
        <a href="https://github.com/langwatch/langwatch/blob/main/python-sdk/langwatch/types.py#L118">
          types definitions
        </a>
        .
      </p>
      <p>
        It's optional but highly recommended to pass the <code>user_id</code> if
        you want to leverage user-specific analytics and the{" "}
        <code>thread_id</code> to group related traces together. Read more about
        those and other concepts{" "}
        <a href="https://docs.langwatch.ai/docs/concepts" target="_blank">
          here
        </a>
        .
      </p>
      <ol>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li>
          Execute the <code>curl</code> command. If successful, LangWatch will
          process your trace data.
        </li>
      </ol>
      <p>
        This method of integration offers a flexible approach for sending traces
        from any system capable of making HTTP requests. Whether you're using a
        less common programming language or a custom-built platform, this
        RESTful approach ensures you can benefit from LangWatch's capabilities.
      </p>
      <p>
        Remember to handle errors and retries as needed. You might need to
        script additional logic around the <code>curl</code> command to handle
        these cases.
      </p>
    </div>
  );
};
