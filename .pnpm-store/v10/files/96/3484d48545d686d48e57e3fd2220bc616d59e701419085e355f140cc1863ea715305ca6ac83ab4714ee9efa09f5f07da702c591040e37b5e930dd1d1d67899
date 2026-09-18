import { Model } from '@openai/agents-core';
import type { ModelRequest, ModelResponse, ResponseStreamEvent } from '@openai/agents-core';
import OpenAI from 'openai';
export declare const FAKE_ID = "FAKE_ID";
/**
 * A model that uses (or is compatible with) OpenAI's Chat Completions API.
 */
export declare class OpenAIChatCompletionsModel implements Model {
    #private;
    constructor(client: OpenAI, model: string);
    getResponse(request: ModelRequest): Promise<ModelResponse>;
    getStreamedResponse(request: ModelRequest): AsyncIterable<ResponseStreamEvent>;
}
