import { isDeepStrictEqual } from "node:util";

import {
  isCredentialHeader,
  withoutLiteralCredential,
  type Agent,
  type AgentOverview,
  type AgentWithFields,
  type HttpAgentConfig,
  type HttpAuth,
} from "@langwatch/agent-contract";
import { isSameOrigin } from "@langwatch/workflow-contract";

type HttpSecrets = Pick<HttpAgentConfig, "headers" | "auth">;
type BlankCredential = (value: string) => string;

function authBlanking(auth: HttpAuth, blank: BlankCredential): HttpAuth {
  switch (auth.type) {
    case "none":
      return auth;
    case "bearer":
      return { ...auth, token: blank(auth.token) };
    case "api_key":
      return { ...auth, value: blank(auth.value) };
    case "basic":
      return { ...auth, password: blank(auth.password) };
  }
}

function httpConfigBlanking(config: HttpAgentConfig, blank: BlankCredential): HttpAgentConfig {
  const { headers, auth } = config;

  return {
    ...config,
    ...(headers
      ? {
          headers: headers.map(({ key, value }) => ({
            key,
            value: isCredentialHeader(key) ? blank(value) : value,
          })),
        }
      : {}),
    ...(auth ? { auth: authBlanking(auth, blank) } : {}),
  };
}

function httpConfigWithoutSecrets(config: HttpAgentConfig): HttpAgentConfig {
  return httpConfigBlanking(config, withoutLiteralCredential);
}

/** A read of an agent: every literal HTTP credential blank; `{{ secrets.NAME }}` references stay. */
export function agentWithoutSecrets(agent: AgentOverview): AgentOverview {
  if (agent.type !== "http") return agent;

  return { ...agent, config: httpConfigWithoutSecrets(agent.config) };
}

/** The same projection for the answer to a write, which carries no copy count. */
export function agentWithFieldsWithoutSecrets(agent: AgentWithFields): AgentWithFields {
  if (agent.type !== "http") return agent;

  return { ...agent, config: httpConfigWithoutSecrets(agent.config) };
}

/** The same projection of the config alone, for the REST answers. */
export function agentConfigWithoutSecrets(agent: Agent): Agent["config"] {
  return agent.type === "http" ? httpConfigWithoutSecrets(agent.config) : agent.config;
}

function authKeepingStored(input: { stored: HttpAuth | undefined; incoming: HttpAuth }): HttpAuth {
  const { stored, incoming } = input;
  if (!stored) return incoming;
  if (incoming.type === "bearer" && stored.type === "bearer" && incoming.token === "") {
    return { ...incoming, token: stored.token };
  }
  if (incoming.type === "api_key" && stored.type === "api_key" && incoming.value === "") {
    return { ...incoming, value: stored.value };
  }
  if (incoming.type === "basic" && stored.type === "basic" && incoming.password === "") {
    return { ...incoming, password: stored.password };
  }

  return incoming;
}

/** A blank credential on a write means "unchanged": the stored value takes its place. */
export function httpSecretsKeepingStored<T extends HttpSecrets>(input: {
  stored: HttpSecrets;
  incoming: T;
}): T {
  const { stored, incoming } = input;
  const headers = incoming.headers?.map((header) =>
    header.value === "" && isCredentialHeader(header.key)
      ? { ...header, value: stored.headers?.find(({ key }) => key === header.key)?.value ?? "" }
      : header,
  );
  const auth = incoming.auth && authKeepingStored({ stored: stored.auth, incoming: incoming.auth });

  return {
    ...incoming,
    ...(headers ? { headers } : {}),
    ...(auth ? { auth } : {}),
  };
}

type HttpDestination = HttpSecrets & { url: string };

/** Whether a write's blank credentials would carry stored values to another origin than the saved one. */
export function movesStoredSecrets(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  if (isSameOrigin({ requested: input.incoming.url, saved: input.stored.url })) return false;
  const filled = httpSecretsKeepingStored(input);

  return !isDeepStrictEqual(
    { headers: filled.headers, auth: filled.auth },
    { headers: input.incoming.headers, auth: input.incoming.auth },
  );
}

/**
 * A source agent's config as a copy in another project takes it: every credential blank,
 * references too, except what the copy already holds for the same origin. In the source's
 * own project the config travels unchanged.
 */
export function configForCopy(input: {
  source: Agent;
  targetProjectId: string;
  current?: Agent;
}): Agent["config"] {
  const { source, current } = input;
  if (source.type !== "http" || source.projectId === input.targetProjectId) return source.config;
  const blank = httpConfigBlanking(source.config, () => "");
  if (current?.type !== "http" || !isSameOrigin({ requested: blank.url, saved: current.config.url })) {
    return blank;
  }

  return httpSecretsKeepingStored({ stored: current.config, incoming: blank });
}
