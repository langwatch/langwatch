import type { Named } from "@langwatch/module";
/**
 * Private model endpoints (ADR-203): staff register the addresses, organizations bind hostnames.
 * The wire shape below is the one contract every TS caller sends to nlpgo and the AI gateway.
 */
import { z } from "zod";

/** The header nlpgo's `/go/proxy/v1` reads the calling organization's bindings from. */
export const PRIVATE_ENDPOINTS_HEADER = "X-LangWatch-Private-Endpoints";

/** The top-level field a workflow payload and the gateway config bundle carry bindings in. */
export const PRIVATE_ENDPOINTS_FIELD = "private_endpoints";

/** One bound hostname: lowercased, no trailing dot, dialled at `addresses` on `port`. */
const privateEndpointBindingWireSchemaDefinition = z.object({
  hostname: z.string(),
  addresses: z.array(z.string()),
  port: z.number().int(),
});
export interface PrivateEndpointBindingWireSchema extends Named<
  typeof privateEndpointBindingWireSchemaDefinition
> {}
export const privateEndpointBindingWireSchema: PrivateEndpointBindingWireSchema =
  privateEndpointBindingWireSchemaDefinition;

export type PrivateEndpointBindingWire = z.infer<typeof privateEndpointBindingWireSchema>;

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** The UTF-8 bytes of a string, with no platform encoder: this contract also loads in a browser. */
function utf8Of(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      );
    }
  }
  return bytes;
}

/** Base64url without padding (RFC 4648 §5), the encoding the header carries the JSON in. */
function base64UrlOf(text: string): string {
  const bytes = utf8Of(text);
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = bytes.slice(at, at + 3);
    const chunk = (a << 16) | (b << 8) | c;
    const width = Math.min(3, bytes.length - at) + 1;
    for (let index = 0; index < width; index++) {
      out += BASE64URL[(chunk >> (18 - 6 * index)) & 63];
    }
  }
  return out;
}

/** The header value for a set of bindings: base64url (no padding) of the JSON array. */
export function encodePrivateEndpointsHeader(
  bindings: readonly PrivateEndpointBindingWire[],
): string {
  return base64UrlOf(JSON.stringify(bindings.map(toWire)));
}

/** The header to merge into an nlpgo proxy call; nothing when the organization has no binding. */
export function privateEndpointsHeaders(
  bindings: readonly PrivateEndpointBindingWire[],
): Record<string, string> {
  if (bindings.length === 0) return {};
  return { [PRIVATE_ENDPOINTS_HEADER]: encodePrivateEndpointsHeader(bindings) };
}

/** The field to spread into a workflow payload or config bundle; nothing when there is none. */
export function privateEndpointsField(bindings: readonly PrivateEndpointBindingWire[]): {
  private_endpoints?: PrivateEndpointBindingWire[];
} {
  if (bindings.length === 0) return {};
  return { private_endpoints: bindings.map(toWire) };
}

/** Exactly the three wire fields, the hostname normalised as the contract says. */
function toWire(binding: PrivateEndpointBindingWire): PrivateEndpointBindingWire {
  return {
    hostname: binding.hostname.trim().toLowerCase().replace(/\.$/, ""),
    addresses: [...binding.addresses],
    port: binding.port,
  };
}

// ── what organizations and staff read ────────────────────────────────────────

/** One hostname an organization bound, as its managers read it. */
const privateModelEndpointBindingSchemaDefinition = z.object({
  id: z.string(),
  endpointId: z.string(),
  hostname: z.string(),
});
export interface PrivateModelEndpointBindingSchema extends Named<
  typeof privateModelEndpointBindingSchemaDefinition
> {}
export const privateModelEndpointBindingSchema: PrivateModelEndpointBindingSchema =
  privateModelEndpointBindingSchemaDefinition;

export type PrivateModelEndpointBinding = z.infer<typeof privateModelEndpointBindingSchema>;

/** Whether any hostname reaches the endpoint yet. */
export const privateModelEndpointStatusSchema = z.enum(["in_use", "unbound"]);

export type PrivateModelEndpointStatus = z.infer<typeof privateModelEndpointStatusSchema>;

/** An endpoint as the organization reads it: never its addresses or port. */
const organizationPrivateModelEndpointSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  region: z.string(),
  status: privateModelEndpointStatusSchema,
  bindings: z.array(privateModelEndpointBindingSchema),
});
export interface OrganizationPrivateModelEndpointSchema extends Named<
  typeof organizationPrivateModelEndpointSchemaDefinition
> {}
export const organizationPrivateModelEndpointSchema: OrganizationPrivateModelEndpointSchema =
  organizationPrivateModelEndpointSchemaDefinition;

export type OrganizationPrivateModelEndpoint = z.infer<
  typeof organizationPrivateModelEndpointSchema
>;

/** An endpoint as staff read it in ops, addresses included. */
const staffPrivateModelEndpointSchemaDefinition = z.object({
  ...organizationPrivateModelEndpointSchemaDefinition.shape,
  organizationId: z.string(),
  addresses: z.array(z.string()),
  port: z.number().int(),
});
export interface StaffPrivateModelEndpointSchema extends Named<
  typeof staffPrivateModelEndpointSchemaDefinition
> {}
export const staffPrivateModelEndpointSchema: StaffPrivateModelEndpointSchema =
  staffPrivateModelEndpointSchemaDefinition;

export type StaffPrivateModelEndpoint = z.infer<typeof staffPrivateModelEndpointSchema>;

// ── what organizations and staff send ────────────────────────────────────────

/** Strict: the binding API has no way to name an address, and an extra field is refused. */
const privateModelEndpointBindInputSchemaDefinition = z
  .object({ organizationId: z.string(), endpointId: z.string(), hostname: z.string() })
  .strict();
export interface PrivateModelEndpointBindInputSchema extends Named<
  typeof privateModelEndpointBindInputSchemaDefinition
> {}
export const privateModelEndpointBindInputSchema: PrivateModelEndpointBindInputSchema =
  privateModelEndpointBindInputSchemaDefinition;

export type PrivateModelEndpointBindInput = z.infer<typeof privateModelEndpointBindInputSchema>;

const privateModelEndpointRebindInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    bindingId: z.string(),
    endpointId: z.string(),
    hostname: z.string(),
  })
  .strict();
export interface PrivateModelEndpointRebindInputSchema extends Named<
  typeof privateModelEndpointRebindInputSchemaDefinition
> {}
export const privateModelEndpointRebindInputSchema: PrivateModelEndpointRebindInputSchema =
  privateModelEndpointRebindInputSchemaDefinition;

export type PrivateModelEndpointRebindInput = z.infer<typeof privateModelEndpointRebindInputSchema>;

const privateModelEndpointUnbindInputSchemaDefinition = z
  .object({ organizationId: z.string(), bindingId: z.string() })
  .strict();
export interface PrivateModelEndpointUnbindInputSchema extends Named<
  typeof privateModelEndpointUnbindInputSchemaDefinition
> {}
export const privateModelEndpointUnbindInputSchema: PrivateModelEndpointUnbindInputSchema =
  privateModelEndpointUnbindInputSchemaDefinition;

export type PrivateModelEndpointUnbindInput = z.infer<typeof privateModelEndpointUnbindInputSchema>;

const privateModelEndpointOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string() })
  .strict();
export interface PrivateModelEndpointOrganizationInputSchema extends Named<
  typeof privateModelEndpointOrganizationInputSchemaDefinition
> {}
export const privateModelEndpointOrganizationInputSchema: PrivateModelEndpointOrganizationInputSchema =
  privateModelEndpointOrganizationInputSchemaDefinition;

const privateModelEndpointRegisterInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    name: z.string(),
    region: z.string(),
    addresses: z.array(z.string()),
    port: z.number().int().default(443),
  })
  .strict();
export interface PrivateModelEndpointRegisterInputSchema extends Named<
  typeof privateModelEndpointRegisterInputSchemaDefinition
> {}
export const privateModelEndpointRegisterInputSchema: PrivateModelEndpointRegisterInputSchema =
  privateModelEndpointRegisterInputSchemaDefinition;

export type PrivateModelEndpointRegisterInput = z.infer<
  typeof privateModelEndpointRegisterInputSchema
>;

const privateModelEndpointUpdateInputSchemaDefinition = z
  .object({
    organizationId: z.string(),
    endpointId: z.string(),
    name: z.string(),
    region: z.string(),
    addresses: z.array(z.string()),
    port: z.number().int(),
  })
  .strict();
export interface PrivateModelEndpointUpdateInputSchema extends Named<
  typeof privateModelEndpointUpdateInputSchemaDefinition
> {}
export const privateModelEndpointUpdateInputSchema: PrivateModelEndpointUpdateInputSchema =
  privateModelEndpointUpdateInputSchemaDefinition;

export type PrivateModelEndpointUpdateInput = z.infer<typeof privateModelEndpointUpdateInputSchema>;

const privateModelEndpointRemoveInputSchemaDefinition = z
  .object({ organizationId: z.string(), endpointId: z.string() })
  .strict();
export interface PrivateModelEndpointRemoveInputSchema extends Named<
  typeof privateModelEndpointRemoveInputSchemaDefinition
> {}
export const privateModelEndpointRemoveInputSchema: PrivateModelEndpointRemoveInputSchema =
  privateModelEndpointRemoveInputSchemaDefinition;

export type PrivateModelEndpointRemoveInput = z.infer<typeof privateModelEndpointRemoveInputSchema>;
