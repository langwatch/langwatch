import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { weatherTool } from "./tools/weather-tool.js";

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  instructions: `You are a helpful weather assistant that provides accurate weather information to users.
When asked about weather, use the weather tool to get current conditions.
Always include temperature, humidity, and wind speed in your responses.
Be concise and friendly.`,
  model: openai("gpt-4o"),
  tools: { weatherTool },
});
