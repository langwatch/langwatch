import {
  fillsStoredSecrets,
  isPreviousSigningSecretOpen,
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
  type PreviousSigningSecret,
} from "@langwatch/agent-contract";
import type { Instant } from "@langwatch/time";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "@langwatch/webhook-contract";
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

/** Where hook calls went with the stored credentials: the stored hooks URL, else the turn URL. */
function trustedHooksOrigin(stored: HttpDestination): string {
  return stored.hooksUrl || stored.url;
}

/** Whether the write sends hook calls to another origin than credentials were trusted to. */
function movesHooksUrl(input: { stored: HttpDestination; incoming: HttpDestination }): boolean {
  const { hooksUrl } = input.incoming;

  return (
    Boolean(hooksUrl) &&
    !isSameOrigin({ requested: hooksUrl ?? "", saved: trustedHooksOrigin(input.stored) })
  );
}

/**
 * Whether a write's blank credentials would carry stored values to another origin than the saved
 * one, for the turn URL or the hooks URL. Safe to ask after the save stored typed values as
 * references: storing never fills a blank.
 */
export function movesBlankStoredSecrets(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  const movesToTurnUrl =
    !isSameOrigin({ requested: input.incoming.url, saved: input.stored.url }) &&
    fillsStoredSecrets(input);
  const movesToHooksUrl =
    movesHooksUrl(input) && (fillsStoredSecrets(input) || fillsStoredSigningSecret(input));

  return movesToTurnUrl || movesToHooksUrl;
}

/**
 * Whether a write, as typed, would carry a stored credential to another origin: a blank one, or
 * (for the hooks URL) its `{{ secrets.NAME }}` reference sent back. Ask it before any secret is
 * stored: once stored, a typed value equal to the stored one reads as its reference.
 */
export function movesStoredSecrets(input: {
  stored: HttpDestination;
  incoming: HttpDestination;
}): boolean {
  return movesBlankStoredSecrets(input) || (movesHooksUrl(input) && carriesStoredReference(input));
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
  // The source's rotation window names a secret of its own project: never carried across.
  const { hooksPreviousSigningSecret: _sourceWindow, ...blank } = httpConfigBlanking(
    source.config,
    () => "",
  );
  if (
    current?.type !== "http" ||
    !isSameOrigin({ requested: blank.url, saved: current.config.url })
  ) {
    return blank;
  }
  const { hooksPreviousSigningSecret } = current.config;

  return {
    ...httpSecretsKeepingStored({ stored: current.config, incoming: blank }),
    ...(hooksPreviousSigningSecret ? { hooksPreviousSigningSecret } : {}),
  };
}

/**
 * A config with no hooks URL holds no signing secret: removing the hooks removes the secret, so
 * the "blank keeps the stored one" rule cannot put it back and the save deletes it (ADR-188).
 */
export function withoutHooklessSigningSecret<
  Config extends Pick<HttpAgentConfig, "hooksUrl" | "hooksSigningSecret">,
>(config: Config): Config {
  if (config.hooksUrl?.trim() || config.hooksSigningSecret === undefined) return config;
  const { hooksSigningSecret: _removed, ...rest } = config;

  return rest as Config;
}

/**
 * The signing secrets a save left unused: the current or previous one named before that the saved
 * config names nowhere. Only a name the save made for this agent, never one the person picked or
 * another agent still names (a copy in the same project keeps the reference).
 */
export function replacedSigningSecretNames(input: {
  agentId: string;
  before: Agent;
  after: Agent;
  projectAgents: readonly Agent[];
}): string[] {
  const { agentId, before, after } = input;
  if (before.type !== "http") return [];
  const held = [
    before.config.hooksSigningSecret,
    before.config.hooksPreviousSigningSecret?.secret,
  ].map((value) => readSecretReference(value ?? ""));
  const owned = held.flatMap((read) =>
    read.isReference &&
    isStoredSecretNameFor({ name: read.name, owner: agentId, field: HOOKS_SIGNING_SECRET_FIELD })
      ? [read.name]
      : [],
  );

  return [...new Set(owned)].filter((name) => {
    const reference = new RegExp(`secrets\\.${name}(?![A-Z0-9_])`);
    const named = (agent: Agent) => reference.test(JSON.stringify(agent.config));

    return (
      !named(after) && !input.projectAgents.some((agent) => agent.id !== agentId && named(agent))
    );
  });
}

type SigningWindowConfig = Pick<
  HttpAgentConfig,
  "url" | "hooksUrl" | "hooksSigningSecret" | "hooksPreviousSigningSecret"
>;

/**
 * The rotation window a save leaves, as webhook endpoints keep one: never a third secret, none on
 * a moved or removed hooks URL (the old secret was trusted to the old receiver only), and never
 * the window a write sends. Spec: scenario-run-hooks.feature, "Hooks on an HTTP agent".
 */
export function withPreviousSigningSecret<Config extends SigningWindowConfig>(input: {
  stored: SigningWindowConfig;
  saved: Config;
  now: Instant;
}): Config {
  const { stored, saved, now } = input;
  const { hooksPreviousSigningSecret: _sent, ...config } = saved;
  const keepsOrigin =
    Boolean(saved.hooksUrl?.trim()) &&
    saved.hooksSigningSecret !== undefined &&
    isSameOrigin({ requested: saved.hooksUrl ?? "", saved: trustedHooksOrigin(stored) });
  if (!keepsOrigin) return config as Config;
  // Only a stored reference is kept: the window is read back, so it must never hold a value.
  const rotated =
    readSecretReference(stored.hooksSigningSecret ?? "").isReference &&
    stored.hooksSigningSecret !== saved.hooksSigningSecret;
  const window: PreviousSigningSecret | undefined = rotated
    ? {
        secret: stored.hooksSigningSecret ?? "",
        expiresAt: now.add({ milliseconds: WEBHOOK_PREVIOUS_SECRET_TTL_MS }).toString(),
      }
    : stored.hooksPreviousSigningSecret;
  if (!window || !isPreviousSigningSecretOpen(window, now)) return config as Config;

  return { ...config, hooksPreviousSigningSecret: window } as Config;
}
