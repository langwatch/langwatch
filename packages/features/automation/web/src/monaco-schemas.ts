/** Monaco replaces its global schema list on every diagnostics update. */

// Editor models and schema file matches must use the same stable URI.
export const CONDITIONS_MODEL_URI = "file:///automation/conditions.json";

/** Mirrors the permissive nested filter shape accepted by the transport. */
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

/** Matches the server allowlist; image blocks stay excluded to prevent tracking pixels. */
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
          // Server delivery rejects section accessories.
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
        // Bundled templates use Slack's non-interactive markdown block.
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

type JsonSchemaRegistration = {
  uri: string;
  fileMatch: string[];
  schema: object;
};

export type AutomationMonaco = {
  languages: {
    json: {
      jsonDefaults: {
        setDiagnosticsOptions(options: {
          validate: boolean;
          allowComments: boolean;
          schemas: JsonSchemaRegistration[];
        }): void;
      };
    };
  };
};

interface RegisteredEntry {
  schema: object;
  fileMatch: string[];
}

const registered = new Map<string, RegisteredEntry>();

/** Registers one model schema while retaining every previously registered schema. */
export function registerJsonSchema(
  monaco: AutomationMonaco,
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
