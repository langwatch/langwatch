import { tool } from "ai";
import { z } from "zod";

export const generateCode = tool({
  description: "Generates or updates code based on the system prompt and the user request",
  parameters: z.object({
    newCode: z.string(),
  }),
});

export const tools = {
  generateCode,
};
