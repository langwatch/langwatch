import {
  fillsStoredSecrets,
  HOOKS_SIGNING_SECRET_FIELD,
  httpSecretsKeepingStored,
  isCredentialHeader,
  isStoredSecretNameFor,
  readSecretReference,
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

/** Every credential value a config holds: credential headers, auth secret, signing secret. */
function credentialValues(config: HttpDestination): string[] {
  const values: string[] = [];
  httpConfigBlanking(config as HttpAgentConfig, (value) => {
    values.push(value);
    return value;
  });
  return values;
}

/**
 * Whether the write sends back a `{{ secrets.NAME }}` reference the stored config holds. A read
 * of the agent keeps references, so the form saves them back unchanged: that is a stored secret
 * carried along just as a blank one is.
 */
function carriesStoredReference(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const stored = new Set(
    credentialValues(input.stored).filter((value) => readSecretReference(value).isReference),
  );
  return credentialValues(input.incoming).some((value) => stored.has(value));
}

/**
 * Hook calls go where credentials were trusted: the stored hooks URL, else the turn URL. A hooks
 * URL on another origin takes no stored credential, blank or as its reference: the person types
 * the headers and auth again and rotates the signing secret.
 */
function movesStoredSecretsToHooksUrl(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const { stored, incoming } = input;
  if (!incoming.hooksUrl) return false;
  const trusted = stored.hooksUrl || stored.url;
  if (isSameOrigin({ requested: incoming.hooksUrl, saved: trusted })) return false;

  return (
    fillsStoredSecrets(input) || fillsStoredSigningSecret(input) || carriesStoredReference(input)
  );
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

/**
 * The signing secrets a save left unused (none or one): the one named before, when the saved
 * config names another or none. Only a name the save made for this agent, never one the person
 * picked or another agent still names (a copy in the same project keeps the reference).
 */
export function replacedSigningSecretNames(input: {
  agentId: string;
  before: Agent;
  after: Agent;
  projectAgents: readonly Agent[];
}): string[] {
  const { agentId, before, after } = input;
  if (before.type !== "http") return [];
  const previous = readSecretReference(before.config.hooksSigningSecret ?? "");
  if (!previous.isReference) return [];
  const { name } = previous;
  if (!isStoredSecretNameFor({ name, owner: agentId, field: HOOKS_SIGNING_SECRET_FIELD })) {
    return [];
  }
  const reference = new RegExp(`secrets\\.${name}(?![A-Z0-9_])`);
  const named = (agent: Agent) => reference.test(JSON.stringify(agent.config));
  if (named(after)) return [];
  const stillNamed = input.projectAgents.some((agent) => agent.id !== agentId && named(agent));

  return stillNamed ? [] : [name];
}
