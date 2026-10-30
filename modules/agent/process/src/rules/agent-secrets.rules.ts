import {
  fillsStoredSecrets,
  httpSecretsKeepingStored,
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
  const { headers, auth, hooksSigningSecret } = config;

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
    ...(hooksSigningSecret ? { hooksSigningSecret: blank(hooksSigningSecret) } : {}),
  };
}

function httpConfigWithoutSecrets(config: HttpAgentConfig): HttpAgentConfig {
  return httpConfigBlanking(config, withoutLiteralCredential);
}

/**
 * A read of an agent: every literal HTTP credential blank; `{{ secrets.NAME }}` references stay.
 */
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

type HttpDestination = HttpSecrets &
  Pick<HttpAgentConfig, "hooksSigningSecret" | "hooksUrl"> & { url: string };

function fillsStoredSigningSecret(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const { stored, incoming } = input;

  return stored.hooksSigningSecret !== undefined && !incoming.hooksSigningSecret;
}

/** Hook calls go where credentials were trusted: the stored hooks URL, else the turn URL. */
function movesStoredSecretsToHooksUrl(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const { stored, incoming } = input;
  if (!incoming.hooksUrl) return false;
  const trusted = stored.hooksUrl || stored.url;
  if (isSameOrigin({ requested: incoming.hooksUrl, saved: trusted })) return false;

  return fillsStoredSecrets(input) || fillsStoredSigningSecret(input);
}

/**
 * Whether a write's blank credentials would carry stored values to another origin than the saved
 * one, for the turn URL or the hooks URL.
 */
export function movesStoredSecrets(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const movesToTurnUrl =
    !isSameOrigin({ requested: input.incoming.url, saved: input.stored.url }) &&
    fillsStoredSecrets(input);

  return movesToTurnUrl || movesStoredSecretsToHooksUrl(input);
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
  if (
    current?.type !== "http" ||
    !isSameOrigin({ requested: blank.url, saved: current.config.url })
  ) {
    return blank;
  }

  return httpSecretsKeepingStored({ stored: current.config, incoming: blank });
}
