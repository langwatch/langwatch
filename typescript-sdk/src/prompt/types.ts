export interface PromptMessage {
  role: string;
  content: string;
}

export interface PromptResponseFormat {
  type: 'json_schema';
  json_schema: {
    name: string;
    schema: unknown;
  };
}

export interface PromptDefinition {
  id: string;
  name: string;
  updatedAt: string;
  version: number;
  versionId: string;
  versionCreatedAt: string;
  model: string;
  prompt: string;
  messages: PromptMessage[];
  response_format: PromptResponseFormat | null;
}

export interface PromptInput {
  identifier: string;
  type: string;
}

export interface PromptOutput {
  identifier: string;
  type: string;
  json_schema: {
    type: string;
  };
}

export interface DemonstrationColumn {
  id: string;
  name: string;
  type: string;
}

export interface Demonstrations {
  columns: DemonstrationColumn[];
  rows: unknown[];
}

export interface PromptingTechnique {
  ref: string;
}

export interface PromptConfigData {
  version: number;
  prompt: string;
  messages: PromptMessage[];
  inputs: PromptInput[];
  outputs: PromptOutput[];
  model: string;
  temperature: number;
  max_tokens: number;
  demonstrations: Demonstrations;
  prompting_technique: PromptingTechnique;
}

export type GetPromptVersionResponse = GetPromptVersion[];

export interface GetPromptVersion {
  id: string;
  authorId: string;
  projectId: string;
  configId: string;
  schemaVersion: string;
  commitMessage: string;
  version: number;
  createdAt: string;
  configData: PromptConfigData;
}
