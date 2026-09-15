import type { AgentCallSignal } from "@langwatch/agent-contract";
import {
  type AgentConnection,
  type AgentConnectCredentials,
  type AgentConnectFramesInput,
  type AgentConnectPollInput,
  type AgentConnectPollAnswer,
  type AgentPresence,
  type CallOutcome,
  type AgentConnectRegisterAnswer,
  type AgentServerConfig,
  type DispatchAgent,
  type DispatchCall,
} from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { ConnectedAgentRuntimeService } from "./connected-agent-runtime.service.ts";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import type { AgentService } from "./agent.service.ts";
import { ConnectedAgentConnectionService } from "./connected-agent-connection.service.ts";
import { ConnectedAgentCredentialService } from "./connected-agent-credential.service.ts";
import { LongPollTransportService } from "./connected-agent-long-poll.service.ts";
import { ConnectedAgentPresenceService } from "./connected-agent-presence.service.ts";
import { AgentSessionService } from "./connected-agent-session.service.ts";

export type ConnectedAgentOptions = {
  agents: AgentService;
  apiKeys: ApiKeyApi;
  authz: AuthzApi;
  projects: ProjectApi;
  redis: RedisConnection | null;
  config: AgentServerConfig;
  publicBaseUrl: string;
};

export class ConnectedAgentService {
  readonly #runtime;
  readonly #connections;
  readonly #polling;

  static create(options: ConnectedAgentOptions): ConnectedAgentService {
    return new ConnectedAgentService(options);
  }

  private constructor(options: ConnectedAgentOptions) {
    this.#runtime = ConnectedAgentRuntimeService.create({
      store: SessionStateStoreFactory.create({ redis: options.redis }),
    });
    const session = AgentSessionService.create({
      runtime: this.#runtime,
      agents: options.agents,
      credentials: ConnectedAgentCredentialService.create(options),
      publicBaseUrl: options.publicBaseUrl,
      replicaCount: options.config.replicaCount,
      relayMaxPayloadMb: options.config.relayMaxPayloadMb,
    });
    this.#connections = ConnectedAgentConnectionService.create({ session });
    this.#polling = LongPollTransportService.create({ session });
  }

  start(): Promise<void> {
    return this.#runtime.dispatcher.start();
  }

  acceptConnection(
    connection: AgentConnection,
    credentials: AgentConnectCredentials,
  ): Promise<void> {
    return this.#connections.accept(connection, credentials);
  }

  async connectRegister(
    body: unknown,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectRegisterAnswer> {
    return this.#polling.register({ body, credentials });
  }

  connectPoll(
    input: AgentConnectPollInput,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectPollAnswer> {
    return this.#polling.poll({ ...input, credentials, token: credentials.instanceToken });
  }

  connectFrames(
    input: AgentConnectFramesInput,
    credentials: AgentConnectCredentials,
  ): Promise<{ accepted: number }> {
    return this.#polling.frames({ ...input, credentials, token: credentials.instanceToken });
  }

  dispatch(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal?: AgentCallSignal;
  }): Promise<CallOutcome> {
    return this.#runtime.dispatcher.dispatch(input);
  }

  listPresence(input: {
    projectId: string;
    agents: readonly { id: string; type: string }[];
  }): Promise<Map<string, AgentPresence>> {
    return ConnectedAgentPresenceService.readAgentPresence({ ...input, runtime: this.#runtime });
  }

  async close(): Promise<void> {
    let failure: unknown;
    for (const close of [
      () => this.#connections.close(),
      () => this.#polling.close(),
      () => this.#runtime.dispatcher.close(),
      () => this.#runtime.store.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
}
