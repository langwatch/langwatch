// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { FieldDef } from "./parser-field-controls.ts";

/**
 * An AWS source signs with an AWS connection and lists agents in the regions named. Both fields
 * are drawn by `cloudAgentCustomControl`: a connection picker and region chips.
 */
export const AWS_BEDROCK_AGENTS_FIELDS: FieldDef[] = [
  {
    key: "awsConnectionId",
    label: "AWS connection",
    placeholder: "Pick a connection",
    hint: "The AWS access this source signs in with. It needs bedrock:ListAgents, bedrock:GetAgent, bedrock:ListAgentAliases, bedrock-agentcore:ListAgentRuntimes and the matching ListTagsForResource.",
    required: true,
    control: "custom",
  },
  {
    key: "regions",
    label: "Regions",
    placeholder: "eu-west-1",
    hint: "Your Bedrock agents and AgentCore runtimes are listed in each region you add.",
    required: true,
    control: "custom",
  },
];

/** A Google Cloud source reads Vertex AI reasoning engines with a service account key. */
export const GCP_VERTEX_AGENT_ENGINE_FIELDS: FieldDef[] = [
  {
    key: "targets",
    label: "Projects and locations",
    placeholder: "acme-ml",
    hint: "Each project and location your Vertex AI agents run in, such as europe-west4.",
    required: true,
    control: "custom",
  },
  {
    key: "credentialsServiceAccountJson",
    label: "Service account key",
    placeholder: '{"type": "service_account", ...}',
    hint: "Paste the service account key file. It needs the Vertex AI Viewer role. We encrypt it and never show it again.",
    editHint: "A key is saved. Leave blank to keep it, or paste a new key file to replace it.",
    required: true,
    secret: true,
  },
];

/** An ARD source reads a registry's manifest and, when named, its search endpoint. */
export const ARD_REGISTRY_FIELDS: FieldDef[] = [
  {
    key: "registryUrl",
    label: "Registry address",
    placeholder: "registry.acme.test",
    hint: "The domain or https address that serves /.well-known/ard.json.",
    required: true,
  },
  {
    key: "searchUrl",
    label: "Search endpoint",
    placeholder: "https://registry.acme.test/search",
    hint: "Optional. Add it when the registry lists more agents through search than in its manifest.",
    advanced: true,
  },
  {
    key: "credentialsBearerToken",
    label: "Bearer token",
    placeholder: "Optional",
    hint: "Sent with every request when the registry needs one. We encrypt it and never show it again.",
    editHint: "Leave blank to keep the saved token, or enter a new one to replace it.",
    secret: true,
    advanced: true,
  },
];
