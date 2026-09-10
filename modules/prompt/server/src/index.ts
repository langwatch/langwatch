export type { PromptService } from "./services/prompt.service.ts";
export { PostgresPromptAdapter } from "./services/prompt-postgres-composition.service.ts";
export { promptServer } from "./prompt.server.ts";
export {
  PromptApp,
  PromptHasNoCopiesError,
  PromptNoCopiesSelectedError,
  PromptNotACopyError,
  PromptTagInvalidError,
  PromptTagMissingError,
  PromptTagProtectedRefusalError,
  PromptTagTakenError,
  type PromptCaller,
  type PromptInfrastructure,
  type PromptTagCatalogPrincipal,
} from "./app/prompt.app.ts";
/** The three declarations a process mounts, and the wire shapes REST publishes. */
export {
  apiResponsePromptTagSchema,
  apiResponsePromptWithVersionDataSchema,
  buildStandardSuccessResponse,
  createPromptInputSchema,
  handlePossibleConflictError,
  handleSystemPromptHandledErrors,
  promptRest,
  promptRestCredential,
  promptRestFacts,
  updateHandleInputSchema,
  updatePromptInputSchema,
  versionInputSchema,
  type ApiResponsePrompt,
} from "./transport/prompt.rest.ts";
export { promptTrpcTransport } from "./transport/prompt.trpc.ts";
export { promptTagTrpcTransport } from "./transport/prompt-tag.trpc.ts";
// The playground's execution door still runs on the deleted builder: its
// refusals have no registered handled codes and its seven process capabilities
// are functions, which neither a fact nor `PromptApi` can carry.
export {
  createPromptExecuteRestApp,
  CrossOriginRefusedError,
  type PromptExecuteRestMembers,
  type PromptExecuteRestSession,
} from "./transport/prompt-execute.api.ts";
