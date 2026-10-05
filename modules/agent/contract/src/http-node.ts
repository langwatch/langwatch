import { z } from "zod";

import type { HttpAgentConfig, HttpAuth, HttpHeader, HttpMethod } from "./config/http.ts";
import type { Field } from "./fields.ts";

export type HttpCallConfig = {
  url: string;
  method?: HttpMethod;
  headers?: HttpHeader[];
  auth?: HttpAuth;
  bodyTemplate?: string;
  outputPath?: string;
  timeoutMs?: number;
};

export function buildHttpNodeParameters(config: HttpCallConfig): Field[] {
  const parameters: Field[] = [
    { identifier: "url", type: "str", value: config.url },
    { identifier: "method", type: "str", value: config.method ?? "POST" },
  ];
  if (config.bodyTemplate)
    parameters.push({
      identifier: "body_template",
      type: "str",
      value: config.bodyTemplate,
    });
  if (config.outputPath)
    parameters.push({
      identifier: "output_path",
      type: "str",
      value: config.outputPath,
    });
  const headers = Object.fromEntries(
    (config.headers ?? [])
      .map(({ key, value }) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0),
  );
  if (Object.keys(headers).length > 0)
    parameters.push({ identifier: "headers", type: "dict", value: headers });
  if (config.timeoutMs)
    parameters.push({
      identifier: "timeout_ms",
      type: "int",
      value: config.timeoutMs,
    });
  if (config.auth && config.auth.type !== "none") {
    parameters.push({
      identifier: "auth_type",
      type: "str",
      value: config.auth.type,
    });
    if (config.auth.type === "bearer")
      parameters.push({
        identifier: "auth_token",
        type: "str",
        value: config.auth.token,
      });
    if (config.auth.type === "api_key") {
      parameters.push({
        identifier: "auth_header",
        type: "str",
        value: config.auth.header,
      });
      parameters.push({
        identifier: "auth_value",
        type: "str",
        value: config.auth.value,
      });
    }
    if (config.auth.type === "basic") {
      parameters.push({
        identifier: "auth_username",
        type: "str",
        value: config.auth.username,
      });
      parameters.push({
        identifier: "auth_password",
        type: "str",
        value: config.auth.password,
      });
    }
  }
  return parameters;
}

type NodeParameter = { identifier: string; value?: unknown };

const SECRET_PARAMETERS: readonly string[] = ["auth_token", "auth_value", "auth_password"];
/** The fields of an `auth` dict parameter that hold the credential itself. */
const AUTH_SECRET_FIELDS: readonly string[] = ["token", "value", "password"];
const valueMapSchema = z.record(z.string(), z.unknown());

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function valueOf(parameters: readonly NodeParameter[], identifier: string): unknown {
  return parameters.find((parameter) => parameter.identifier === identifier)?.value;
}

const CREDENTIAL_HEADER_NAMES: readonly string[] = [
  "authorization",
  "x-api-key",
  "cookie",
  "proxy-authorization",
];
const CREDENTIAL_HEADER_WORD = /key|token|secret|auth|password/i;

/** Whether a header carries a credential: save stores it, read blanks it, a trace redacts it. */
export function isCredentialHeader(key: string): boolean {
  const name = key.trim().toLowerCase();

  return CREDENTIAL_HEADER_NAMES.includes(name) || CREDENTIAL_HEADER_WORD.test(name);
}

const SECRET_REFERENCE_VALUE = /^((Bearer|Basic|Token) )?\{\{ secrets\.([A-Z0-9_]+) \}\}$/;

/** The project secret a stored credential points at, or nothing when it is not a reference. */
export function secretReferenceOf(value: string): string | undefined {
  return SECRET_REFERENCE_VALUE.exec(value)?.[3];
}

const LOOSE_SECRET_REFERENCE =
  /^\s*(?:(bearer|basic|token)\s+)?\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}\s*$/i;

/** A reference typed loosely ("bearer {{secrets.X}}") in the spelling `secretReferenceOf` reads. */
function inReferenceSpelling(value: string): string {
  const match = LOOSE_SECRET_REFERENCE.exec(value);
  if (!match?.[2]) return value;
  const scheme = match[1]
    ? `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()} `
    : "";

  return `${scheme}{{ secrets.${match[2]} }}`;
}

const CREDENTIAL_SCHEMES = ["Bearer", "Basic", "Token", "ApiKey", "Key", "Bot", "Digest"] as const;
type CredentialScheme = (typeof CREDENTIAL_SCHEMES)[number];

/** The scheme as a pattern matching it in any case, as HTTP schemes match. */
function caselessPattern(scheme: CredentialScheme): string {
  return scheme.replace(/[a-z]/gi, (letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`);
}

const REFERENCE = String.raw`\{\{\s*secrets\.[A-Z][A-Z0-9_]*\s*\}\}`;
/** References joined only by separators, behind a listed scheme and a space (`ApiKey `) or a
 * field label of 1-32 characters and `=`/`:` (`api_key=`), captured to check its digits. */
const SCHEMED_REFERENCES = new RegExp(
  String.raw`^(?:(?:${CREDENTIAL_SCHEMES.map(caselessPattern).join("|")})\s+|([A-Za-z][A-Za-z0-9_-]{0,31})\s*[:=]\s*)?` +
    String.raw`${REFERENCE}(?:[\s:=]*${REFERENCE})*$`,
);
const MAX_LABEL_DIGITS = 4;

/** Whether a label names a field: more than a few digits (`ghp_abc123def456`) makes it a token. */
function isFieldLabel(label: string): boolean {
  return label.replace(/\D/g, "").length <= MAX_LABEL_DIGITS;
}

/** A value that is not blank and holds more than `{{ secrets.NAME }}` references, separators
 * and one listed scheme or field label; any other word or token-shaped label makes it a literal. */
export function holdsLiteralCredential(value: string): boolean {
  const text = value.trim();
  if (text === "" || secretReferenceOf(inReferenceSpelling(text)) !== undefined) return false;
  const match = SCHEMED_REFERENCES.exec(text);
  const label = match?.[1];

  return match === null || (label !== undefined && !isFieldLabel(label));
}

/** The value as a read may answer it: a reference, in its stored spelling, never a credential. */
export function withoutLiteralCredential(value: unknown): string {
  if (typeof value !== "string") return "";

  return holdsLiteralCredential(value) ? "" : inReferenceSpelling(value);
}

type BlankCredential = (value: unknown) => string;

function blankMapEntries(input: {
  value: unknown;
  isCredential: (key: string) => boolean;
  blank: BlankCredential;
}): unknown {
  const entries = valueMapSchema.safeParse(input.value);

  return entries.success
    ? Object.fromEntries(
        Object.entries(entries.data).map(([key, value]) => [
          key,
          input.isCredential(key) ? input.blank(value) : value,
        ]),
      )
    : input.value;
}

function isAuthSecretField(field: string): boolean {
  return AUTH_SECRET_FIELDS.includes(field);
}

function parametersBlanking<Parameter extends NodeParameter>(input: {
  parameters: readonly Parameter[];
  blank: BlankCredential;
}): Parameter[] {
  const { blank } = input;

  return input.parameters.map((parameter) => {
    const { identifier, value } = parameter;
    if (SECRET_PARAMETERS.includes(identifier)) return { ...parameter, value: blank(value) };
    if (identifier === "headers") {
      return {
        ...parameter,
        value: blankMapEntries({ value, isCredential: isCredentialHeader, blank }),
      };
    }
    if (identifier === "auth") {
      return {
        ...parameter,
        value: blankMapEntries({ value, isCredential: isAuthSecretField, blank }),
      };
    }

    return parameter;
  });
}

/** An HTTP node's parameters with every literal credential blank; header names and
 * the auth kind stay. */
export function httpNodeParametersWithoutSecrets<Parameter extends NodeParameter>(
  parameters: readonly Parameter[],
): Parameter[] {
  return parametersBlanking({ parameters, blank: withoutLiteralCredential });
}

/** Every credential blank, references too: what a copy into another project carries. */
export function httpNodeParametersWithoutCredentials<Parameter extends NodeParameter>(
  parameters: readonly Parameter[],
): Parameter[] {
  return parametersBlanking({ parameters, blank: () => "" });
}

function headersKeepingStored(input: { incoming: unknown; stored: unknown }): unknown {
  const incoming = valueMapSchema.safeParse(input.incoming);
  const stored = valueMapSchema.safeParse(input.stored);
  if (!incoming.success || !stored.success) return input.incoming;

  return Object.fromEntries(
    Object.entries(incoming.data).map(([key, value]) => [
      key,
      isBlank(value) && isCredentialHeader(key) ? (stored.data[key] ?? value) : value,
    ]),
  );
}

/** A blank credential on an HTTP node takes the saved agent's value, where the auth
 * kind is the same. The caller checks the node calls the agent's saved origin. */
export function httpNodeParametersKeepingStored<Parameter extends NodeParameter>(input: {
  parameters: readonly Parameter[];
  stored: HttpCallConfig;
}): Parameter[] {
  const stored = buildHttpNodeParameters(input.stored);
  const sameAuth = valueOf(input.parameters, "auth_type") === valueOf(stored, "auth_type");

  return input.parameters.map((parameter) => {
    if (parameter.identifier === "headers") {
      return {
        ...parameter,
        value: headersKeepingStored({
          incoming: parameter.value,
          stored: valueOf(stored, "headers"),
        }),
      };
    }
    const storedValue = valueOf(stored, parameter.identifier);
    if (
      sameAuth &&
      SECRET_PARAMETERS.includes(parameter.identifier) &&
      isBlank(parameter.value) &&
      storedValue !== undefined
    ) {
      return { ...parameter, value: storedValue };
    }

    return parameter;
  });
}

export type SecretWriter = {
  values(): Promise<Readonly<Record<string, string>>>;
  create(input: { name: string; value: string }): Promise<void>;
};

/** Stores one credential as a project secret and answers the reference that replaces it. */
export type SecretReferencer = (input: {
  owner: string;
  field: string;
  value: string;
}) => Promise<string>;

function upperSnake(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const MAX_NAME_ATTEMPTS = 3;

/** The base name, or the first numbered one that is free or already holds the value. */
function freeName(input: {
  names: ReadonlyMap<string, string>;
  base: string;
  value: string;
}): string {
  let name = input.base;
  for (let suffix = 2; input.names.has(name) && input.names.get(name) !== input.value; suffix++) {
    name = `${input.base}_${suffix}`;
  }

  return name;
}

/**
 * Names each secret HTTP_<OWNER>_<FIELD>, with a numeric suffix where the name is taken. A name
 * already holding the same value is reused, so saving the same token stores nothing.
 */
export function createSecretReferencer(writer: SecretWriter): SecretReferencer {
  let known: Map<string, string> | undefined;
  const reread = async (): Promise<Map<string, string>> => {
    known = new Map(Object.entries(await writer.values()));

    return known;
  };
  const store = async (input: {
    base: string;
    value: string;
    attempt: number;
  }): Promise<string> => {
    const names = known ?? (await reread());
    const name = freeName({ names, base: input.base, value: input.value });
    if (names.get(name) === input.value) return `{{ secrets.${name} }}`;
    try {
      await writer.create({ name, value: input.value });
    } catch (error) {
      // A concurrent first save may have taken the name: re-read, then reuse it or number on.
      if (input.attempt >= MAX_NAME_ATTEMPTS || !(await reread()).has(name)) throw error;

      return store({ ...input, attempt: input.attempt + 1 });
    }
    names.set(name, input.value);

    return `{{ secrets.${name} }}`;
  };

  return ({ owner, field, value }) =>
    store({
      base: ["HTTP", upperSnake(owner), upperSnake(field)].filter(Boolean).join("_"),
      value,
      attempt: 1,
    });
}

type CredentialStorer = (field: string, value: string) => Promise<string>;

function credentialStorer(input: { owner: string; reference: SecretReferencer }): CredentialStorer {
  const { owner, reference } = input;

  return async (field, value) =>
    holdsLiteralCredential(value) ? reference({ owner, field, value }) : inReferenceSpelling(value);
}

async function entriesStoringSecrets(input: {
  entries: readonly (readonly [string, unknown])[];
  entryField: EntryField;
  store: CredentialStorer;
}): Promise<[string, unknown][]> {
  const { entryField } = input;
  const stored: [string, unknown][] = [];
  for (const [key, value] of input.entries) {
    const storable = typeof value === "string" && entryField.holdsCredential(key);
    stored.push([key, storable ? await input.store(`${entryField.prefix}${key}`, value) : value]);
  }

  return stored;
}

interface EntryField {
  holdsCredential: (key: string) => boolean;
  prefix: string;
}

/** The dict parameters whose entries may hold a credential, and the field each is stored under. */
const HEADER_ENTRY_FIELD: EntryField = { holdsCredential: isCredentialHeader, prefix: "header_" };

const ENTRY_FIELDS: ReadonlyMap<string, EntryField> = new Map([
  ["headers", HEADER_ENTRY_FIELD],
  ["auth", { holdsCredential: isAuthSecretField, prefix: "auth_" }],
]);

async function parameterStoringSecrets<Parameter extends NodeParameter>(input: {
  parameter: Parameter;
  store: CredentialStorer;
}): Promise<Parameter> {
  const { parameter, store } = input;
  const { identifier, value } = parameter;
  if (SECRET_PARAMETERS.includes(identifier)) {
    return typeof value === "string"
      ? { ...parameter, value: await store(identifier, value) }
      : parameter;
  }
  const entryField = ENTRY_FIELDS.get(identifier);
  const entries = entryField ? valueMapSchema.safeParse(value) : undefined;
  if (!entryField || !entries?.success) return parameter;
  const stored = await entriesStoringSecrets({
    entries: Object.entries(entries.data),
    entryField,
    store,
  });

  return { ...parameter, value: Object.fromEntries(stored) };
}

/** An HTTP node's parameters with each literal credential stored as a project secret. */
export async function httpNodeParametersStoringSecrets<Parameter extends NodeParameter>(input: {
  parameters: readonly Parameter[];
  owner: string;
  reference: SecretReferencer;
}): Promise<Parameter[]> {
  const store = credentialStorer(input);
  const stored: Parameter[] = [];
  for (const parameter of input.parameters) {
    stored.push(await parameterStoringSecrets({ parameter, store }));
  }

  return stored;
}

async function authStoringSecrets(input: {
  auth: HttpAuth;
  store: CredentialStorer;
}): Promise<HttpAuth> {
  const { auth, store } = input;
  switch (auth.type) {
    case "none":
      return auth;
    case "bearer":
      return { ...auth, token: await store("auth_token", auth.token) };
    case "api_key":
      return { ...auth, value: await store("auth_value", auth.value) };
    case "basic":
      return { ...auth, password: await store("auth_password", auth.password) };
  }
}

/** An HTTP agent's config with each literal credential stored as a project secret. */
export async function httpAgentConfigStoringSecrets<
  Config extends Pick<HttpAgentConfig, "headers" | "auth">,
>(input: { config: Config; owner: string; reference: SecretReferencer }): Promise<Config> {
  const store = credentialStorer(input);
  const { headers, auth } = input.config;
  const storedAuth = auth && (await authStoringSecrets({ auth, store }));
  const entries = await entriesStoringSecrets({
    entries: (headers ?? []).map(({ key, value }): [string, unknown] => [key, value]),
    entryField: HEADER_ENTRY_FIELD,
    store,
  });
  const storedHeaders: HttpHeader[] = entries.map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : "",
  }));

  return {
    ...input.config,
    ...(headers ? { headers: storedHeaders } : {}),
    ...(storedAuth ? { auth: storedAuth } : {}),
  };
}
