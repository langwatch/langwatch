import {
  httpNodeParametersKeepingStored,
  httpNodeParametersStoringSecrets,
  httpNodeParametersWithoutCredentials,
  httpNodeParametersWithoutSecrets,
  type HttpAgentConfig,
  type SecretReferencer,
} from "@langwatch/agent-contract";
import { z } from "zod";

import type {
  WorkflowVersion,
  WorkflowVersionHistoryEntry,
  WorkflowWithVersion,
} from "./workflow.ts";

const AGENT_REFERENCE_PREFIX = "agents/";

const parameterSchema = z.looseObject({ identifier: z.string(), value: z.unknown().optional() });
type NodeParameter = z.infer<typeof parameterSchema>;

const httpAgentNodeSchema = z.looseObject({
  data: z.looseObject({
    agent: z.string().startsWith(AGENT_REFERENCE_PREFIX),
    parameters: z.array(parameterSchema),
  }),
});

const dslNodesSchema = z.array(z.looseObject({}));

function httpAgentNodeOf(node: unknown) {
  const parsed = httpAgentNodeSchema.safeParse(node);
  if (!parsed.success) return null;
  const { agent, parameters } = parsed.data.data;
  const isHttp = parameters.some(
    ({ identifier, value }) => identifier === "agent_type" && value === "http",
  );

  return isHttp
    ? { agentId: agent.slice(AGENT_REFERENCE_PREFIX.length), data: parsed.data.data, parameters }
    : null;
}

function rewriteHttpAgentNodes<Node extends object>(input: {
  nodes: readonly Node[];
  rewrite: (http: { agentId: string; parameters: NodeParameter[] }) => NodeParameter[];
}): Node[] {
  return input.nodes.map((node) => {
    const http = httpAgentNodeOf(node);
    if (!http) return node;

    return {
      ...node,
      data: { ...http.data, parameters: input.rewrite(http) },
    };
  });
}

/** The saved agents a graph's HTTP agent nodes run, each id once. */
export function httpAgentIdsOf(nodes: readonly unknown[]): string[] {
  return [
    ...new Set(
      nodes.flatMap((node) => {
        const http = httpAgentNodeOf(node);

        return http ? [http.agentId] : [];
      }),
    ),
  ];
}

function rewriteHttpNodes<Node extends object>(input: {
  nodes: readonly Node[];
  rewrite: (parameters: NodeParameter[]) => NodeParameter[];
}): Node[] {
  return input.nodes.map((node) => {
    const http = httpNodeOf(node);

    return http
      ? { ...node, data: { ...http.data, parameters: input.rewrite(http.data.parameters) } }
      : node;
  });
}

/** HTTP nodes with every literal credential blank; `{{ secrets.NAME }}` references stay. */
export function nodesWithoutHttpAgentSecrets<Node extends object>(nodes: readonly Node[]): Node[] {
  return rewriteHttpNodes({ nodes, rewrite: httpNodeParametersWithoutSecrets });
}

/** A graph as a copy into another project takes it: every HTTP credential blank, references too. */
export function dslWithoutHttpCredentials<Dsl extends { nodes?: unknown }>(dsl: Dsl): Dsl {
  const nodes = dslNodesSchema.safeParse(dsl.nodes);

  return nodes.success
    ? {
        ...dsl,
        nodes: rewriteHttpNodes({
          nodes: nodes.data,
          rewrite: httpNodeParametersWithoutCredentials,
        }),
      }
    : dsl;
}

/** The URL's origin, or none where it has no fixed one: unparseable, or a template in its host. */
export function findOrigins(url: string): string[] {
  try {
    const parsed = new URL(url);
    // A reference in the userinfo or host is resolved when the call is made, and can move the host.
    const resolvesLater = /\{|%7B/i.test(`${parsed.username}${parsed.password}${parsed.host}`);

    return parsed.origin === "null" || resolvesLater ? [] : [parsed.origin];
  } catch {
    return [];
  }
}

/** Whether two addresses share scheme, host and port, default ports and case normalised. */
export function isSameOrigin({ requested, saved }: { requested: string; saved: string }): boolean {
  if (requested === saved) return true;
  const [requestedOrigin] = findOrigins(requested);

  return requestedOrigin !== undefined && requestedOrigin === findOrigins(saved)[0];
}

/** Blank credentials on a saved HTTP agent's node take the agent's stored values, only
 * where the node calls the agent's saved origin. */
export function nodesWithStoredHttpAgentSecrets<Node extends object>(input: {
  nodes: readonly Node[];
  stored: ReadonlyMap<string, HttpAgentConfig>;
}): Node[] {
  return rewriteHttpAgentNodes({
    nodes: input.nodes,
    rewrite: ({ agentId, parameters }) => {
      const stored = input.stored.get(agentId);
      const url = parameters.find(({ identifier }) => identifier === "url")?.value;
      const atSavedOrigin =
        stored !== undefined &&
        typeof url === "string" &&
        isSameOrigin({ requested: url, saved: stored.url });

      return stored && atSavedOrigin
        ? httpNodeParametersKeepingStored({ parameters, stored })
        : parameters;
    },
  });
}

/** A graph with every literal HTTP credential blank. */
export function dslWithoutHttpAgentSecrets<Dsl extends { nodes?: unknown }>(dsl: Dsl): Dsl {
  const nodes = dslNodesSchema.safeParse(dsl.nodes);

  return nodes.success ? { ...dsl, nodes: nodesWithoutHttpAgentSecrets(nodes.data) } : dsl;
}

/** A graph whose saved HTTP agents' blank credentials take the agents' stored values. */
export function dslWithStoredHttpAgentSecrets<Dsl extends { nodes?: unknown }>(input: {
  dsl: Dsl;
  stored: ReadonlyMap<string, HttpAgentConfig>;
}): Dsl {
  const nodes = dslNodesSchema.safeParse(input.dsl.nodes);

  return nodes.success
    ? {
        ...input.dsl,
        nodes: nodesWithStoredHttpAgentSecrets({ nodes: nodes.data, stored: input.stored }),
      }
    : input.dsl;
}

/** A version as a read answers it: no literal HTTP credential. */
export function versionWithoutHttpAgentSecrets(version: WorkflowVersion): WorkflowVersion {
  return { ...version, dsl: dslWithoutHttpAgentSecrets(version.dsl) };
}

export function workflowWithoutHttpAgentSecrets(
  workflow: WorkflowWithVersion,
): WorkflowWithVersion {
  return {
    ...workflow,
    ...(workflow.currentVersion
      ? { currentVersion: versionWithoutHttpAgentSecrets(workflow.currentVersion) }
      : {}),
    ...(workflow.latestVersion
      ? { latestVersion: versionWithoutHttpAgentSecrets(workflow.latestVersion) }
      : {}),
  };
}

export function historyEntryWithoutHttpAgentSecrets(
  entry: WorkflowVersionHistoryEntry,
): WorkflowVersionHistoryEntry {
  return entry.dsl ? { ...entry, dsl: dslWithoutHttpAgentSecrets(entry.dsl) } : entry;
}

const httpNodeSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  data: z.looseObject({
    name: z.string().optional(),
    parameters: z.array(parameterSchema),
  }),
});

/** Any HTTP node: the inline component, or a node running a saved HTTP agent. */
function httpNodeOf(node: unknown) {
  const parsed = httpNodeSchema.safeParse(node);
  if (!parsed.success) return null;
  const isHttp =
    parsed.data.type === "http" ||
    parsed.data.data.parameters.some(
      ({ identifier, value }) => identifier === "agent_type" && value === "http",
    );

  return isHttp ? parsed.data : null;
}

const SECRET_REFERENCE_NAME = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Each secret an HTTP call references, paired with the origin the call sends it to; "" where
 * the address has no fixed origin. */
export function secretReferralsOf(call: { url: unknown; fields: unknown }): [string, string][] {
  const origin = typeof call.url === "string" ? (findOrigins(call.url)[0] ?? "") : "";
  const text = JSON.stringify(call.fields) ?? "";

  return [...text.matchAll(SECRET_REFERENCE_NAME)].flatMap(([, name]): [string, string][] =>
    name ? [[name, origin]] : [],
  );
}

/** Each secret a graph's HTTP nodes reference, paired with the origin each node sends it to. */
export function httpNodeSecretReferralsOf(nodes: readonly unknown[]): [string, string][] {
  return nodes.flatMap((node) => {
    const http = httpNodeOf(node);
    if (!http) return [];
    const { parameters } = http.data;
    const url = parameters.find(({ identifier }) => identifier === "url")?.value;

    return secretReferralsOf({ url, fields: parameters });
  });
}

/**
 * A graph with every HTTP node's literal credential stored as a project secret and
 * replaced by its `{{ secrets.NAME }}` reference.
 */
export async function dslStoringHttpSecrets<Dsl extends { nodes?: unknown }>(input: {
  dsl: Dsl;
  reference: SecretReferencer;
}): Promise<Dsl> {
  const nodes = dslNodesSchema.safeParse(input.dsl.nodes);
  if (!nodes.success) return input.dsl;

  const stored: object[] = [];
  for (const node of nodes.data) {
    const http = httpNodeOf(node);
    if (!http) {
      stored.push(node);
      continue;
    }
    const url = http.data.parameters.find(({ identifier }) => identifier === "url")?.value;
    const parameters = await httpNodeParametersStoringSecrets({
      parameters: http.data.parameters,
      // A saved agent's node names its secrets from the agent's id, as the agent does.
      owner: httpAgentNodeOf(node)?.agentId ?? http.data.name ?? http.id ?? "node",
      origin: typeof url === "string" ? findOrigins(url)[0] : undefined,
      reference: input.reference,
    });
    stored.push({ ...http, data: { ...http.data, parameters } });
  }

  return { ...input.dsl, nodes: stored };
}
