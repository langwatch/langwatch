/**
 * Secrets more than one owner holds: one handle each, claimed by instance, so a
 * double claim passes only for this very handle (ARCHITECTURE.md §6, layer 3).
 */
import { Secret } from "./secret.ts";

/** The browser-session key: auth builds sessions from it, automation signs unsubscribe links. */
export const sessionSecret = Secret.load("NEXTAUTH_SECRET", { optional: true });

/** The platform's own OpenAI key: model-provider dispatches on it, evaluation reads it. */
export const openAiApiKey = Secret.load("OPENAI_API_KEY", { optional: true });
