/**
 * Compatibility entry point for the app router. Agents transport composition
 * lives under runtime/app; feature-server imports are forbidden here.
 */
export { agentsRouter } from "~/runtime/app/internal-api/agents.router";
