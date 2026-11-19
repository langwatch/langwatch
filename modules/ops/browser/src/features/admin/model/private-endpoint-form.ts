/** The private endpoint form staff fill in (ADR-203): what they type, and what is sent. */
import type { StaffPrivateModelEndpoint } from "@langwatch/model-provider-contract";

export const PRIVATE_ENDPOINT_DEFAULT_PORT = 443;

export interface PrivateEndpointForm {
  name: string;
  region: string;
  /** Comma- or newline-separated, as typed. */
  addresses: string;
  port: string;
}

export type PrivateEndpointField = keyof PrivateEndpointForm;

export type PrivateEndpointFieldErrors = Partial<Record<PrivateEndpointField, string>>;

export const EMPTY_PRIVATE_ENDPOINT_FORM: PrivateEndpointForm = {
  name: "",
  region: "",
  addresses: "",
  port: String(PRIVATE_ENDPOINT_DEFAULT_PORT),
};

export function privateEndpointFormOf(endpoint: StaffPrivateModelEndpoint): PrivateEndpointForm {
  return {
    name: endpoint.name,
    region: endpoint.region,
    addresses: endpoint.addresses.join("\n"),
    port: String(endpoint.port),
  };
}

/** Each address on its own, split on commas, whitespace and new lines; blanks dropped. */
export function parseAddresses(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((address) => address.trim())
    .filter((address) => address !== "");
}

/** The values to send, or the fields the form refuses before anything is sent. */
export function privateEndpointValues(
  form: PrivateEndpointForm,
):
  | { ok: true; values: { name: string; region: string; addresses: string[]; port: number } }
  | { ok: false; errors: PrivateEndpointFieldErrors } {
  const port = Number(form.port);
  if (form.port.trim() === "" || !Number.isInteger(port)) {
    return { ok: false, errors: { port: "Enter a whole number from 1 to 65535." } };
  }
  return {
    ok: true,
    values: {
      name: form.name.trim(),
      region: form.region.trim(),
      addresses: parseAddresses(form.addresses),
      port,
    },
  };
}

const FIELDS: readonly PrivateEndpointField[] = ["name", "region", "addresses", "port"];

/** The first message the server's `meta.fieldErrors` carries for each field this form shows. */
export function serverRefusedPrivateEndpointFields(error: unknown): PrivateEndpointFieldErrors {
  const fieldErrors = (error as { meta?: { fieldErrors?: Record<string, unknown> } } | null)?.meta
    ?.fieldErrors;
  const refused: PrivateEndpointFieldErrors = {};
  for (const field of FIELDS) {
    const refusal = fieldErrors?.[field];
    const message: unknown = Array.isArray(refusal) ? refusal[0] : refusal;
    if (typeof message === "string") refused[field] = message;
  }
  return refused;
}
