import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("The city to get weather for"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    conditions: z.string(),
  }),
  execute: async ({ context }) => {
    // Simulated weather data
    return {
      temperature: 22,
      humidity: 65,
      windSpeed: 12,
      conditions: "Partly cloudy",
    };
  },
});
