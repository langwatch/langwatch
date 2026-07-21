import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

export function createSkillJudgeModel() {
	const geminiApiKey = process.env.GEMINI_API_KEY;
	if (geminiApiKey) {
		const google = createGoogleGenerativeAI({ apiKey: geminiApiKey });
		return google("gemini-2.5-flash-lite");
	}

	return openai("gpt-5-mini");
}
