import type { UIMessage } from "ai";
import { z } from "zod";

type EnginePart = UIMessage["parts"][number];

/**
 * One part as the chat engine carries it. Langy's stored and outbound parts include its own
 * members (cards, choice selections) beside the SDK's; every renderer routes on `type` and narrows
 * the rest structurally, so `type` is what a part must prove before it enters the engine.
 */
const langyEnginePartSchema = z.custom<EnginePart>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string",
  { message: "A message part must name its type" },
);

const langyEnginePartsSchema = z.array(langyEnginePartSchema);

/** Parts off the wire, the store or a card, checked into the engine's part list. */
export function toEngineParts(parts: readonly unknown[]): UIMessage["parts"] {
  return langyEnginePartsSchema.parse(parts);
}

/** A message whose parts crossed a boundary (the durable projection, the tape), for the engine. */
export function toEngineMessage({
  id,
  role,
  parts,
  metadata,
}: {
  id: string;
  role: UIMessage["role"];
  parts: readonly unknown[];
  metadata?: unknown;
}): UIMessage {
  return {
    id,
    role,
    parts: toEngineParts(parts),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
