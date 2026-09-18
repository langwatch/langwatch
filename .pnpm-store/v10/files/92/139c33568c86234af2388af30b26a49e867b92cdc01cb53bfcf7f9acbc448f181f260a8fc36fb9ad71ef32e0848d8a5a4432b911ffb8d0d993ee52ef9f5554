import { HostedTool } from '@openai/agents-core';
import type OpenAI from 'openai';
import { z } from 'zod';
export declare const WebSearchStatus: z.ZodDefault<z.ZodEnum<["in_progress", "completed", "searching", "failed"]>>;
export declare const FileSearchStatus: z.ZodDefault<z.ZodEnum<["in_progress", "completed", "searching", "failed", "incomplete"]>>;
export declare const CodeInterpreterStatus: z.ZodDefault<z.ZodEnum<["in_progress", "completed", "interpreting"]>>;
export declare const ImageGenerationStatus: z.ZodDefault<z.ZodEnum<["in_progress", "completed", "generating", "failed"]>>;
/**
 * The built-in Web search tool
 *
 * see https://platform.openai.com/docs/guides/tools-web-search?api-mode=responses
 */
export type WebSearchTool = {
    type: 'web_search';
    name?: 'web_search' | 'web_search_preview' | (string & {});
    /**
     * Optional location for the search. Lets you customize results to be relevant to a location.
     */
    userLocation?: OpenAI.Responses.WebSearchTool.UserLocation;
    /**
     * Optional filters for the search.
     */
    filters?: {
        allowedDomains?: Array<string> | null;
    };
    /**
     * High level guidance for the amount of context window space to use for the
     * search. One of `low`, `medium`, or `high`. `medium` is the default.
     */
    searchContextSize: 'low' | 'medium' | 'high';
};
/**
 * Adds web search abilities to your agent
 * @param options Additional configuration for the web search like specifying the location of your agent
 * @returns a web search tool definition
 */
export declare function webSearchTool(options?: Partial<Omit<WebSearchTool, 'type'>>): HostedTool;
/**
 * The built-in File search (backed by vector stores) tool
 */
export type FileSearchTool = {
    type: 'file_search';
    name?: 'file_search' | (string & {});
    /**
     * The IDs of the vector stores to search.
     */
    vectorStoreId: string[];
    /**
     * The maximum number of results to return.
     */
    maxNumResults?: number;
    /**
     * Whether to include the search results in the output produced by the LLM.
     */
    includeSearchResults?: boolean;
    /**
     * Ranking options for search.
     */
    rankingOptions?: OpenAI.Responses.FileSearchTool.RankingOptions;
    /**
     * A filter to apply based on file attributes.
     */
    filters?: OpenAI.ComparisonFilter | OpenAI.CompoundFilter;
};
/**
 * Adds file search abilities to your agent
 * @param vectorStoreIds The IDs of the vector stores to search.
 * @param options Additional configuration for the file search like specifying the maximum number of results to return.
 * @returns a file search tool definition
 */
export declare function fileSearchTool(vectorStoreIds: string | string[], options?: Partial<Omit<FileSearchTool, 'type' | 'vectorStoreId'>>): HostedTool;
export type CodeInterpreterTool = {
    type: 'code_interpreter';
    name?: 'code_interpreter' | (string & {});
    container?: string | OpenAI.Responses.Tool.CodeInterpreter.CodeInterpreterToolAuto;
};
/**
 * Adds code interpreter abilities to your agent
 * @param options Additional configuration for the code interpreter
 * @returns a code interpreter tool definition
 */
export declare function codeInterpreterTool(options?: Partial<Omit<CodeInterpreterTool, 'type'>>): HostedTool;
/**
 * The built-in Image generation tool
 */
export type ImageGenerationTool = {
    type: 'image_generation';
    name?: 'image_generation' | (string & {});
    background?: 'transparent' | 'opaque' | 'auto' | (string & {});
    inputFidelity?: 'high' | 'low' | null;
    inputImageMask?: OpenAI.Responses.Tool.ImageGeneration.InputImageMask;
    model?: 'gpt-image-1' | 'gpt-image-1-mini' | 'gpt-image-1.5' | (string & {});
    moderation?: 'auto' | 'low' | (string & {});
    outputCompression?: number;
    outputFormat?: 'png' | 'webp' | 'jpeg' | (string & {});
    partialImages?: number;
    quality?: 'low' | 'medium' | 'high' | 'auto' | (string & {});
    size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto' | (string & {});
};
/**
 * Adds image generation abilities to your agent
 * @param options Additional configuration for the image generation
 * @returns an image generation tool definition
 */
export declare function imageGenerationTool(options?: Partial<Omit<ImageGenerationTool, 'type'>>): HostedTool;
