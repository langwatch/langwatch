/**
 * Builds the external URL of a resource in the LangWatch UI, so a REST caller
 * can link straight to what it just read or wrote.
 *
 * A port rather than a function: the origin comes from the running
 * deployment's validated environment, which a transport package has no access
 * to and must not read for itself.
 */
export type PlatformUrlBuilder = (args: { projectSlug: string; path: string }) => string;
