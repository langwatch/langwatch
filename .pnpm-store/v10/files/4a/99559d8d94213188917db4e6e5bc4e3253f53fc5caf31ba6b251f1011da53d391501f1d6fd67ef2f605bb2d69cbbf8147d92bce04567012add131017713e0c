import { Model, ModelProvider } from '@openai/agents-core';
import OpenAI from 'openai';
/**
 * Options for OpenAIProvider.
 */
export type OpenAIProviderOptions = {
    apiKey?: string;
    baseURL?: string;
    organization?: string;
    project?: string;
    useResponses?: boolean;
    openAIClient?: OpenAI;
};
/**
 * The provider of OpenAI's models (or Chat Completions compatible ones)
 */
export declare class OpenAIProvider implements ModelProvider {
    #private;
    constructor(options?: OpenAIProviderOptions);
    getModel(modelName?: string | undefined): Promise<Model>;
}
