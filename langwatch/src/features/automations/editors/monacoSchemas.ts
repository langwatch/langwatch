import type { Monaco } from "@monaco-editor/react";

/**
 * Monaco JSON Schemas used by the automation drawer. Each editor mounts with a
 * stable model URI (the `path` prop) and registers a `fileMatch` entry that
 * targets that URI; Monaco's built-in JSON language then surfaces structural
 * mistakes (unknown fields, wrong types, missing required keys) as inline
 * diagnostics, alongside the regular syntax check.
 *
 * `setDiagnosticsOptions` is a global call that *replaces* the registered
 * schemas, so this module keeps an internal map and re-emits the full list
 * every registration.
 */

// `file:///` URIs make Monaco's JSON language service pick the schemas up
// reliably; `inmemory://` URIs hit edge cases in the parser depending on the
// Monaco version. The model path on the editor mounts to these exact URIs.
export const CONDITIONS_MODEL_URI = "file:///automation/conditions.json";

/** Permissive shape mirroring `triggerFiltersPermissiveSchema` server-side:
 *  filter values are either an array of strings, or a nested object whose
 *  leaves are arrays of strings. */
export const CONDITIONS_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Automation conditions",
  description:
    "Object of filter fields. Values may be an array of strings, or a nested object whose leaves are arrays of strings.",
  type: "object",
  additionalProperties: {
    oneOf: [
      { type: "array", items: { type: "string" } },
      {
        type: "object",
        additionalProperties: {
          oneOf: [
            { type: "array", items: { type: "string" } },
            {
              type: "object",
              additionalProperties: { type: "array", items: { type: "string" } },
            },
          ],
        },
      },
    ],
  },
} as const;

/** Slack Block Kit subset matching the server-side allowlist (ADR-026):
 *  section, divider, context, header, image. Liquid expressions inside string
 *  values are not validated by JSON Schema — that is intentional. */
export const SLACK_BLOCK_KIT_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Slack Block Kit (allowlisted subset)",
  type: "array",
  items: {
    oneOf: [
      {
        title: "section",
        type: "object",
        required: ["type"],
        additionalProperties: false,
        properties: {
          type: { const: "section" },
          block_id: { type: "string" },
          text: {
            type: "object",
            required: ["type", "text"],
            properties: {
              type: { enum: ["mrkdwn", "plain_text"] },
              text: { type: "string" },
              emoji: { type: "boolean" },
            },
          },
          fields: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "text"],
              properties: {
                type: { enum: ["mrkdwn", "plain_text"] },
                text: { type: "string" },
              },
            },
          },
          accessory: {
            type: "object",
            required: ["type"],
            properties: {
              type: { const: "image" },
              image_url: { type: "string" },
              alt_text: { type: "string" },
            },
          },
        },
      },
      {
        title: "divider",
        type: "object",
        required: ["type"],
        additionalProperties: false,
        properties: {
          type: { const: "divider" },
          block_id: { type: "string" },
        },
      },
      {
        title: "context",
        type: "object",
        required: ["type", "elements"],
        additionalProperties: false,
        properties: {
          type: { const: "context" },
          block_id: { type: "string" },
          elements: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "text"],
              properties: {
                type: { enum: ["mrkdwn", "plain_text"] },
                text: { type: "string" },
              },
            },
          },
        },
      },
      {
        title: "header",
        type: "object",
        required: ["type", "text"],
        additionalProperties: false,
        properties: {
          type: { const: "header" },
          block_id: { type: "string" },
          text: {
            type: "object",
            required: ["type", "text"],
            properties: {
              type: { const: "plain_text" },
              text: { type: "string" },
              emoji: { type: "boolean" },
            },
          },
        },
      },
      {
        title: "image",
        type: "object",
        required: ["type", "image_url", "alt_text"],
        additionalProperties: false,
        properties: {
          type: { const: "image" },
          block_id: { type: "string" },
          image_url: { type: "string" },
          alt_text: { type: "string" },
          title: {
            type: "object",
            properties: {
              type: { const: "plain_text" },
              text: { type: "string" },
            },
          },
        },
      },
    ],
  },
} as const;

const registered = new Map<string, object>();

/**
 * Registers (or replaces) a JSON Schema keyed to a model URI. Idempotent —
 * calling with the same URI updates the schema, calling with different URIs
 * stacks them. Safe to invoke from `beforeMount` of every editor.
 */
export function registerJsonSchema(
  monaco: Monaco,
  modelUri: string,
  schema: object,
): void {
  registered.set(modelUri, schema);
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: Array.from(registered.entries()).map(([uri, s]) => ({
      uri: `inmemory://schemas/${encodeURIComponent(uri)}.schema.json`,
      fileMatch: [uri],
      schema: s,
    })),
  });
}
