import type { RequestState } from "./codegen.ts";
import { paramKey } from "./codegen.ts";
import type { Operation } from "./operation.ts";

export function validateRequest({
  operation,
  state,
  key,
}: {
  operation: Operation;
  state: RequestState;
  key: string;
}) {
  const { values, body } = state;
  const required = operation.parameters.filter((param) => param.required);
  const scheme = operation.schemes[0];
  const nextErrors: Record<string, string> = {};
  for (const param of required) {
    if (!values[paramKey({ location: param.in, name: param.name })]?.trim())
      nextErrors[paramKey({ location: param.in, name: param.name })] = `${param.name} is required.`;
  }
  if (scheme && !key.trim()) nextErrors.auth = "Enter an API key.";
  if (operation.body?.required && !body.trim()) nextErrors.body = "Enter a request body.";
  if (body.trim()) {
    try {
      JSON.parse(body);
    } catch (error) {
      nextErrors.body = `Invalid JSON: ${error instanceof Error ? error.message : "could not parse"}`;
    }
  }
  return nextErrors;
}

export function errorFieldId({ first }: { first: string }) {
  if (first === "auth") return "pg-auth";
  if (first === "body") return "pg-body";
  return `pg-${first.replace(":", "-")}`;
}
