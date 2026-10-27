import type { Actor } from "@langwatch/authorization";
import type { EvaluatorCaller } from "@langwatch/evaluator-contract";

/**
 * The caller a version and the delete deploy check name, from the door's actor. Every
 * evaluator route authenticates, so a missing actor is a wiring defect.
 */
export function evaluatorCallerOf(actor: Actor | null): EvaluatorCaller {
  if (actor === null) throw new Error("An evaluator write reached the door without an actor");
  if (actor.type === "user") return { type: "user", id: actor.id };
  if (actor.type === "api_key") return { type: "api_key", id: actor.id };
  return { type: "system" };
}
