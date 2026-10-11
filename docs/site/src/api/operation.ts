export type Schema = {
  type?: string | string[];
  format?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  enum?: unknown[];
  default?: unknown;
  example?: unknown;
  nullable?: boolean;
  deprecated?: boolean;
  additionalProperties?: boolean | Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  $recursive?: string;
};

export type Content = { type: string; schema: Schema | null; example?: unknown };
export type Parameter = { in: string; name: string; required: boolean; deprecated: boolean; description: string; schema: Schema };
export type Scheme = { id: string; type?: string; in?: string; name?: string; scheme?: string; description?: string };

export type Operation = {
  method: string;
  path: string;
  origin: string;
  summary: string;
  description: string;
  deprecated: boolean;
  schemes: Scheme[];
  parameters: Parameter[];
  body: { required: boolean; description: string; contents: Content[] } | null;
  responses: { status: string; description: string; contents: Content[] }[];
};

export type ExampleLanguage = "python" | "typescript" | "curl";
export const EXAMPLE_LANGUAGES: { id: ExampleLanguage; label: string; lang: string }[] = [
  { id: "python", label: "Python", lang: "python" },
  { id: "typescript", label: "TypeScript", lang: "typescript" },
  { id: "curl", label: "curl", lang: "bash" },
];
export type HighlightedExamples = Record<ExampleLanguage, string[]>;
