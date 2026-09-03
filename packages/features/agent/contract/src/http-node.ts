import type { Field } from "./fields";
import type { HttpAuth, HttpHeader, HttpMethod } from "./config/http";

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
