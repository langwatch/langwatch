import type { Monaco } from "@monaco-editor/react";

/**
 * Monaco JSON Schemas used by the automation drawer. Each editor mounts with a
 * stable model URI (the `path` prop) and registers a `fileMatch` entry that
 * targets that URI; Monaco's built-in JSON language then surfaces structural
 * mistakes (unknown fields, wrong types, missing required keys) as inline
 * diagnostics, alongside the regular syntax check.
 *
 * `setDiagnosticsOptions` is a global call that *replaces* the registered
 * schemas — every registration site has to re-emit the full list or the
 * other modules' schemas get wiped. This module keeps the single source of
 * truth in `registered`; sibling editors (Liquid + Block Kit) call
 * `registerJsonSchema` here instead of holding their own map.
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
              additionalProperties: {
                type: "array",
                items: { type: "string" },
              },
            },
          ],
        },
      },
    ],
  },
} as const;

/** Slack Block Kit subset matching the server-side allowlist (ADR-036):
 *  section, divider, context, header, markdown. `image` blocks and section
 *  `image` accessories are deliberately excluded — the server strips them
 *  (blockKitAllowlist.ts: tracking-pixel vector) so Monaco must reject them
 *  at author time or authors ship blocks that silently disappear on dispatch.
 *  Liquid expressions inside string values are not validated by JSON Schema —
 *  that is intentional. */
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
          // Server allowlist strips ALL section accessories (image included)
          // to close the tracking-pixel vector. Deliberately omit here so
          // Monaco rejects any accessory the user writes.
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
      // `image` top-level blocks were removed to match server-side allowlist
      // (blockKitAllowlist.ts: tracking-pixel vector). Do NOT add back without
      // also loosening the server-side filter.
      {
        // ui-001: bundled Slack templates emit `{ "type": "markdown", "text": "…" }`
        // blocks; the schema must allow them or Monaco fires false-positive
        // red squiggles on the default presets. Slack's newer markdown block
        // is non-interactive so it fits the same allow-list criteria.
        title: "markdown",
        type: "object",
        required: ["type", "text"],
        additionalProperties: false,
        properties: {
          type: { const: "markdown" },
          block_id: { type: "string" },
          text: { type: "string" },
        },
      },
    ],
  },
} as const;

interface RegisteredEntry {
  schema: object;
  fileMatch: string[];
}

const registered = new Map<string, RegisteredEntry>();

/**
 * Registers (or replaces) a JSON Schema keyed to a model URI. Idempotent —
 * calling with the same URI updates the entry, calling with different URIs
 * stacks them. Safe to invoke from `beforeMount` of every editor.
 *
 * `fileMatch` defaults to `[modelUri]` (the exact-URI strategy used by the
 * stable editors). Callers with dynamic shadow URIs (e.g. the Liquid
 * substitution shadow) pass a basename pattern like `["**\/<basename>"]`.
 */
export function registerJsonSchema(
  monaco: Monaco,
  modelUri: string,
  schema: object,
  fileMatch: string[] = [modelUri],
): void {
  registered.set(modelUri, { schema, fileMatch });
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: Array.from(registered.entries()).map(([uri, entry]) => ({
      uri: `inmemory://schemas/${encodeURIComponent(uri)}.schema.json`,
      fileMatch: entry.fileMatch,
      schema: entry.schema,
    })),
  });
}
