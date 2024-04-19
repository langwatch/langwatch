import { RenderCode } from "./integration-guides/utils/RenderCode";
import { langwatchEndpointEnv } from "./integration-guides/utils/langwatchEndpointEnv";

export const CustomRestAnalytics = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Usage:</h3>
      <p>
        You will need to obtain your JSON payload from the custom graph section
        in our application. You can find this on the Analytics page &gt; Custom
        Reports &gt; Add chart.
      </p>
      <ol>
        <li>Pick the custom graph you want to get the analytics for.</li>
        <li>
          Prepare your JSON data. Make sure it's is the same format that is
          showing in the LangWatch application.
        </li>
        <li>
          Use the <code>curl</code> command to get you analytics data. Here is a
          basic template:
        </li>
      </ol>
      <RenderCode
        code={`# Set your API key and endpoint URL
API_KEY="${apiKey ?? "your_langwatch_api_key"}"
ENDPOINT="https://app.langwatch.ai/api/analytics"

# Use curl to send the POST request, e.g.:
curl -X POST "$ENDPOINT" \\
     -H "X-Auth-Token: $API_KEY" \\
     -H "Content-Type: application/json" \\
     -d @- <<EOF
     {
      "startDate": 1708434000000,
      "endDate": 1710939600000,
      "filters": {},
      "series": [
        {
          "metric": "metadata.user_id",
          "aggregation": "cardinality"
        }
      ],
      "timeScale": 1
    }
EOF`}
        language="bash"
      />

      <ol>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li style={{ visibility: "hidden", position: "absolute" }}></li>
        <li>
          Execute the <code>curl</code> command. If successful, LangWatch will
          return the custom analytics data in the response.
        </li>
      </ol>
    </div>
  );
};
