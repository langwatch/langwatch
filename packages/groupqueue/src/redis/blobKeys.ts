/** Its own key space, deliberately: a blob spool key never shares a prefix
 * with anything an event references durably (ADR-108 decision 10). */
const PREFIX = "groupqueue:blob";

export function blobRef(tenantId: string, hash: string): string {
  return `${tenantId}/${hash}`;
}

export function blobKeys(ref: string): {
  readonly meta: string;
  readonly data: string;
} {
  return {
    meta: `${PREFIX}:{${ref}}:meta`,
    data: `${PREFIX}:{${ref}}:data`,
  };
}
