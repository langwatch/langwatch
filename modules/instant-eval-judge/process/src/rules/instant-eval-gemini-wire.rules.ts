/**
 * The Gemini generateContent wire of an LLM leg: the request body with its forced function call,
 * and the reading of the call and the tokens billed. The model rides in the path, not the body.
 * @see modules/instant-eval-judge/specs/instant-eval-scenario-judge.feature
 */

import type { InstantEvalScenarioJudgeTool } from "@langwatch/instant-eval-judge-contract";
import { z } from "zod";

/** JSON-schema keys the API refuses in a function's parameters. */
const REFUSED_SCHEMA_KEYS: readonly string[] = ["$schema", "additionalProperties", "strict"];

/** `value` without the refused keys at any depth; arrays and plain values pass through. */
export function instantEvalGeminiSchemaOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(instantEvalGeminiSchemaOf);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !REFUSED_SCHEMA_KEYS.includes(key))
      .map(([key, inner]) => [key, instantEvalGeminiSchemaOf(inner)]),
  );
}

/** One user turn and the tools, with a call of `allowed` (one name, or any offered) required. */
export function instantEvalGeminiBodyOf({
  system,
  user,
  tools,
  allowed,
  maxOutputTokens,
}: {
  system: string;
  user: string;
  tools: readonly InstantEvalScenarioJudgeTool[];
  allowed: readonly string[];
  maxOutputTokens: number;
}): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    tools: [
      {
        functionDeclarations: tools.map(({ name, description, parameters }) => ({
          name,
          description,
          parameters: instantEvalGeminiSchemaOf(parameters),
        })),
      },
    ],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [...allowed] } },
    generationConfig: { maxOutputTokens },
  };
}

const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  functionCall: z
                    .object({ name: z.string(), args: z.unknown().optional() })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});

type GeminiReading = Readonly<{
  /** The first candidate's function calls, in order; none when the body is unreadable. */
  calls: readonly Readonly<{ name: string; args: unknown }>[];
  inputTokens: number;
  /** Thinking tokens are billed as output, so they count here. */
  outputTokens: number;
}>;

export function readInstantEvalGeminiAnswer(body: unknown): GeminiReading {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return { calls: [], inputTokens: 0, outputTokens: 0 };
  const usage = parsed.data.usageMetadata;
  const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
  return {
    calls: parts.flatMap(({ functionCall }) =>
      functionCall ? [{ name: functionCall.name, args: functionCall.args ?? {} }] : [],
    ),
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
  };
}
