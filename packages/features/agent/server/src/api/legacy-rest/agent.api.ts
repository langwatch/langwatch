import type { AgentApp } from "#app/agent.app";

export const legacyAgentsApiDocumentation = {
  deprecated: true,
  tags: ["Legacy"],
  description:
    "Legacy Agents REST compatibility API. New LangWatch product clients use the Agents RPC interface.",
} as const;

/**
 * The legacy REST vocabulary over the feature's application.
 *
 * Transport-neutral: it renames `getById` to the `get` the deprecated surface
 * has always published and forwards everything else, so the wire names a
 * deployed caller depends on are not the names the application answers to.
 */
export class LegacyAgentsRestApi {
  static create(app: AgentApp): LegacyAgentsRestApi {
    return new LegacyAgentsRestApi(app);
  }

  private constructor(private readonly app: AgentApp) {}

  list(input: Parameters<AgentApp["list"]>[0]) {
    return this.app.list(input);
  }

  create(input: Parameters<AgentApp["create"]>[0]) {
    return this.app.create(input);
  }

  get(input: Parameters<AgentApp["getById"]>[0]) {
    return this.app.getById(input);
  }

  update(input: Parameters<AgentApp["update"]>[0]) {
    return this.app.update(input);
  }

  archive(input: Parameters<AgentApp["archive"]>[0]) {
    return this.app.archive(input);
  }
}
