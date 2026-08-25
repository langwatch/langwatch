import { z } from "zod";

export const ingestionKeyMintCommandSchema = z
  .object({
    callerUserId: z.string().min(1),
    ownerUserId: z.string().nullable(),
    organizationId: z.string().min(1),
    projectId: z.string().min(1),
    sourceType: z.string().min(1),
    ingestionTemplateId: z.string().nullable().optional(),
    createdByDeviceLabel: z.string().nullable().optional(),
  })
  .strict();
export type IngestionKeyMintCommand = z.infer<typeof ingestionKeyMintCommandSchema>;

export const issuedIngestionKeySchema = z
  .object({
    token: z.string().min(1),
    apiKeyId: z.string().min(1),
    prefix: z.string().min(1),
    sourceType: z.string().min(1),
  })
  .strict();
export type IssuedIngestionKey = z.infer<typeof issuedIngestionKeySchema>;

export const personalIngestionKeySchema = z
  .object({
    apiKeyId: z.string(),
    sourceType: z.string(),
    lookupId: z.string(),
    ingestionTemplateId: z.string().nullable(),
  })
  .strict();
export type PersonalIngestionKey = z.infer<typeof personalIngestionKeySchema>;

export abstract class GovernanceIngestionKeyService {
  abstract ensureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;

  abstract issueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;

  abstract ensureForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey>;

  abstract listForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]>;
}
