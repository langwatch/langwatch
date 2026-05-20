import type { RetentionPolicy } from "./retentionPolicy.schema";

export interface RetentionPolicyResolver {
  resolve(tenantId: string): Promise<RetentionPolicy | null>;
}
