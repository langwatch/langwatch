export default `import { setupObservability } from "@langwatch/observability/node"; // +
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

setupObservability({ // +
  langwatch: { apiKey: "<api_key>" }, // +
  serviceName: "<project_name>",
});
`;


