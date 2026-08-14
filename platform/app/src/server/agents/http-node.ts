import type {
  Field,
  HttpAuth,
  HttpHeader,
  HttpMethod,
} from "~/optimization_studio/types/dsl";

/**
 * The HTTP call an agent describes, independent of where it was configured.
 *
 * Taken as a plain shape rather than an `HttpComponentConfig` so the agent
 * editor can build one from a form the author has not saved yet, which is the
 * whole point of a test button.
 */
export type HttpCallConfig = {
  url: string;
  method?: HttpMethod;
  headers?: HttpHeader[];
  auth?: HttpAuth;
  bodyTemplate?: string;
  outputPath?: string;
  timeoutMs?: number;
};

/**
 * Turns an HTTP agent's configuration into the parameters the engine's `http`
 * node reads.
 *
 * One builder on purpose. Testing an agent and running it in an evaluation are
 * the same request, so they are the same node: anything expressed here is
 * expressed once, and a field the engine learns to read cannot arrive on one
 * path and not the other. The app used to reimplement the whole call for the
 * test button, which is how an agent could test green against an internal
 * address and then fail its evaluation as a blocked address.
 */
export const buildHttpNodeParameters = ({
  url,
  method,
  headers,
  auth,
  bodyTemplate,
  outputPath,
  timeoutMs,
}: HttpCallConfig): Field[] => {
  const parameters: Field[] = [
    { identifier: "url", type: "str", value: url },
    { identifier: "method", type: "str", value: method ?? "POST" },
  ];

  if (bodyTemplate) {
    parameters.push({
      identifier: "body_template",
      type: "str",
      value: bodyTemplate,
    });
  }

  if (outputPath) {
    parameters.push({
      identifier: "output_path",
      type: "str",
      value: outputPath,
    });
  }

  const headersDict = headerDict(headers);
  if (headersDict) {
    parameters.push({
      identifier: "headers",
      type: "dict",
      value: headersDict,
    });
  }

  if (timeoutMs) {
    parameters.push({
      identifier: "timeout_ms",
      type: "int",
      value: timeoutMs,
    });
  }

  parameters.push(...authParameters(auth));

  return parameters;
};

/**
 * Header rows as the engine wants them, dropping rows whose key is blank.
 *
 * Keys are trimmed because a trailing space in a header name is invisible in
 * the editor and rejected by the endpoint, which reads as "the agent is
 * broken" rather than "there is a space in the header name".
 */
const headerDict = (
  headers: HttpHeader[] | undefined,
): Record<string, string> | undefined => {
  const dict: Record<string, string> = {};
  for (const header of headers ?? []) {
    const key = header.key.trim();
    if (key) {
      dict[key] = header.value ?? "";
    }
  }
  return Object.keys(dict).length > 0 ? dict : undefined;
};

/** Credential parameters for the configured scheme, or none for "none". */
const authParameters = (auth: HttpAuth | undefined): Field[] => {
  if (!auth || auth.type === "none") return [];

  const typeParameter: Field = {
    identifier: "auth_type",
    type: "str",
    value: auth.type,
  };

  switch (auth.type) {
    case "bearer":
      return [
        typeParameter,
        { identifier: "auth_token", type: "str", value: auth.token },
      ];
    case "api_key":
      return [
        typeParameter,
        { identifier: "auth_header", type: "str", value: auth.header },
        { identifier: "auth_value", type: "str", value: auth.value },
      ];
    case "basic":
      return [
        typeParameter,
        { identifier: "auth_username", type: "str", value: auth.username },
        { identifier: "auth_password", type: "str", value: auth.password },
      ];
    default: {
      const exhaustive: never = auth;
      return exhaustive;
    }
  }
};
