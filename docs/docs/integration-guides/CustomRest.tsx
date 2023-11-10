import { RenderCode } from "./utils/RenderCode";

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
        code={`export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
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
  "spans": [
    {
      "type": "llm",
      "id": "span-123",
      "trace_id": "trace-456",
      "vendor": "openai",
      "model": "gpt-4",
      "input": {
        "type": "text",
        "value": "Input text for the LLM"
      },
      "outputs": [
        {
          "type": "text",
          "value": "Output from the LLM"
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
        "started_at": 1617981376,
        "finished_at": 1617981378
      }
    }
  ],
  "user_id": "your_user_identifier",
  "thread_id": "your_thread_identifier"
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
        <a href="https://github.com/langwatch/langwatch/blob/main/python-sdk/langwatch/types.py#L73">
          types definitions
        </a>
        .
      </p>
      <ol>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li>
          Execute the <code>curl</code> command. If successful, LangWatch
          will process your trace data.
        </li>
      </ol>
      <p>
        This method of integration offers a flexible approach for sending traces
        from any system capable of making HTTP requests. Whether you're using a
        less common programming language or a custom-built platform, this
        RESTful approach ensures you can benefit from LangWatch's capabilities.
      </p>
      <p>
        Remember to handle errors and retries as needed. You might need to script additional
        logic around the <code>curl</code> command to handle these cases.
      </p>
    </div>
  );
};
