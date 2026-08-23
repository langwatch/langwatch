import type { AgentService } from "@langwatch/agents-contract";

export const legacyAgentsApiDocumentation = {
  deprecated: true,
  tags: ["Legacy"],
  description:
    "Legacy Agents REST compatibility API. New LangWatch product clients use the Agents RPC interface.",
} as const;

export class LegacyAgentsRestApi {
  static create(service: AgentService): LegacyAgentsRestApi {
    return new LegacyAgentsRestApi(service);
  }

  private constructor(private readonly service: AgentService) {}

  list(input: { projectId: string; page: number; limit: number }) {
    return this.service.list(input);
  }

  create(input: Parameters<AgentService["create"]>[0]) {
    return this.service.create(input);
  }

  get(input: { id: string; projectId: string }) {
    return this.service.getById(input);
  }

  update(input: Parameters<AgentService["update"]>[0]) {
    return this.service.update(input);
  }

  archive(input: Parameters<AgentService["archive"]>[0]) {
    return this.service.archive(input);
  }
}
