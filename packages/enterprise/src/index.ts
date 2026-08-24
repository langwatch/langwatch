import { LICENSING_FEATURE_ID } from "@langwatch/enterprise-licensing-contract";
import { z } from "zod/v4";

export const enterpriseFeatureIdSchema = z.literal(LICENSING_FEATURE_ID);
export type EnterpriseFeatureId = z.infer<typeof enterpriseFeatureIdSchema>;

export const enterpriseFeatureDescriptorSchema = z.object({
  id: enterpriseFeatureIdSchema,
  contractPackage: z.string().min(1),
  serverPackage: z.string().min(1).optional(),
  webPackage: z.string().min(1).optional(),
});
export type EnterpriseFeatureDescriptor = z.infer<
  typeof enterpriseFeatureDescriptorSchema
>;

const LICENSING_DESCRIPTOR = enterpriseFeatureDescriptorSchema.parse({
  id: LICENSING_FEATURE_ID,
  contractPackage: "@langwatch/enterprise-licensing-contract",
  serverPackage: "@langwatch/enterprise-licensing-server",
});

/** Portable feature discovery. Runtime installers belong to composition packages. */
export class EnterpriseCatalogue {
  private constructor(
    private readonly descriptors: readonly EnterpriseFeatureDescriptor[],
  ) {}

  static create(): EnterpriseCatalogue {
    return new EnterpriseCatalogue([LICENSING_DESCRIPTOR]);
  }

  list(): readonly EnterpriseFeatureDescriptor[] {
    return this.descriptors;
  }

  get(id: EnterpriseFeatureId): EnterpriseFeatureDescriptor | undefined {
    return this.descriptors.find((descriptor) => descriptor.id === id);
  }
}
