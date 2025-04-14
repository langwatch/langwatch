import { z } from "zod";

// Types and Schemas ==========================================

export type FieldType = {
  identifier: string;
  type: string;
  value?: any;
  desc?: string;
  optional?: boolean;
};

export const fieldSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  type: z.string().min(1, "Type is required"),
  value: z.any().optional(),
  desc: z.string().optional(),
  optional: z.boolean().optional(),
});

// Schema for the config content form
export const promptConfigContentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  prompt: z.string().default("You are a helpful assistant"),
  model: z.string().default("openai/gpt4-o-mini"),
  inputs: z.array(fieldSchema.omit({ value: true, optional: true })),
  outputs: z.array(fieldSchema.omit({ value: true, optional: true })),
});

// Schema for the version form (just the commit message)
const versionFormSchema = z.object({
  commitMessage: z.string().min(1, "Commit message is required"),
  schemaVersion: z.string().min(1, "Schema version is required"),
});

export type PromptConfigContentFormValues = z.infer<
  typeof promptConfigContentSchema
>;
export type VersionFormValues = z.infer<typeof versionFormSchema>;

// Types for versions display
export type PromptConfigVersion = {
  id: string;
  version: string;
  commitMessage?: string | null;
  schemaVersion: string;
  createdAt: Date;
  author?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  isAutosaved?: boolean;
  isCurrent?: boolean;
  projectId?: string;
};

// Enhanced field type for type safety
export type EnhancedFieldArrayWithId = FieldArrayWithId & FieldType;
