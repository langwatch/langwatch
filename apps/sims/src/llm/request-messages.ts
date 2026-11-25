import { z } from "zod";

z.config({ jitless: true });

export type ChatMessage = { role: string; text: string };

const partSchema = z.object({ text: z.string() });
const partsSchema = z.array(z.unknown());
const contentSchema = z.union([z.string(), partsSchema]).nullish();

/** The fields OpenAI, Anthropic and Gemini bodies carry their conversation in. */
const requestSchema = z.object({
  system: contentSchema,
  messages: z.array(z.object({ role: z.string(), content: contentSchema })).optional(),
  systemInstruction: z.object({ parts: partsSchema }).optional(),
  contents: z.array(z.object({ role: z.string().optional(), parts: partsSchema })).optional(),
});

const textOf = ({ content }: { content: z.infer<typeof contentSchema> }) => {
  if (typeof content === "string") return content;
  return (content ?? [])
    .map((part) => partSchema.safeParse(part).data?.text ?? "")
    .filter((text) => text !== "")
    .join("\n");
};

/** A provider request body as role-and-text turns; anything unrecognised reads as none. */
export const requestMessages = ({ request }: { request: unknown }): ChatMessage[] => {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return [];
  const { system, messages, systemInstruction, contents } = parsed.data;
  const turns: ChatMessage[] = [
    { role: "system", text: textOf({ content: system }) },
    { role: "system", text: textOf({ content: systemInstruction?.parts }) },
    ...(messages ?? []).map(({ role, content }) => ({ role, text: textOf({ content }) })),
    ...(contents ?? []).map(({ role, parts }) => ({
      role: role ?? "user",
      text: textOf({ content: parts }),
    })),
  ];
  return turns.filter((turn) => turn.text !== "");
};
