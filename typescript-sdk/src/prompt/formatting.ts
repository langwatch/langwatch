// Prompt message and config types
/**
 * Represents a single message in a prompt, typically used for chat-based models.
 * @property {string} role - The role of the message sender (e.g., 'system', 'user', 'assistant').
 * @property {string} content - The content of the message, which may include template variables.
 */
export interface PromptMessage {
  role: string;
  content: string;
}

/**
 * Configuration for a prompt, including its messages, model, and versioning information.
 * @property {PromptMessage[]} messages - The sequence of messages that make up the prompt template.
 * @property {string} model - The model identifier this prompt is intended for.
 * @property {string} name - The name of the prompt.
 * @property {string} id - The unique identifier for the prompt.
 * @property {number} version - The version number of the prompt.
 * @property {string} version_id - The unique identifier for this version of the prompt.
 */
export interface PromptConfig {
  messages: PromptMessage[];
  model: string;
  name: string;
  id: string;
  version: number;
  version_id: string;
}

/**
 * Error thrown when required variables are missing from a prompt template during formatting.
 */
export class MissingPromptVariableError extends Error {
  public readonly missingVars: string[];

  /**
   * Constructs a new MissingPromptVariableError.
   * @param {string[]} missingVars - The names of the missing variables.
   */
  constructor(missingVars: string[]) {
    super(`Missing variables for prompt: ${missingVars.join(", ")}`);
    this.missingVars = missingVars;
  }
}

/**
 * Formats a prompt template string by replacing all {{ variable }} placeholders with values from the provided variables object.
 * Throws a MissingPromptVariableError if any required variables are missing.
 *
 * @param {string} template - The prompt template containing {{ variable }} placeholders.
 * @param {Record<string, unknown>} variables - An object mapping variable names to their values.
 * @returns {string} The formatted prompt string with all placeholders replaced.
 * @throws {MissingPromptVariableError} If any required variables are missing from the variables object.
 */
export function formatPromptTemplate(template: string, variables: Record<string, unknown>): string {
  // Find all {{ var }} in the template
  const regex = /{{\s*(\w+)\s*}}/g;
  const missingVars = Array.from(template.matchAll(regex))
    .map(match => match[1])
    .filter((varName): varName is string => typeof varName === "string" && !(varName in variables));
  if (missingVars.length > 0) {
    throw new MissingPromptVariableError(missingVars);
  }

  return template.replace(regex, (_, varName) => String(variables[varName]));
}

/**
 * Formats an array of PromptMessage objects by replacing template variables in each message's content.
 *
 * @param {PromptMessage[]} messages - The array of prompt messages to format.
 * @param {Record<string, unknown>} variables - An object mapping variable names to their values.
 * @returns {PromptMessage[]} A new array of PromptMessage objects with formatted content.
 * @throws {MissingPromptVariableError} If any required variables are missing from the variables object.
 */
export function formatPromptMessages(messages: PromptMessage[], variables: Record<string, unknown>): PromptMessage[] {
  return messages.map(msg => formatPromptMessage(msg, variables));
}

/**
 * Formats a single PromptMessage by replacing template variables in its content.
 *
 * @param {PromptMessage} message - The prompt message to format.
 * @param {Record<string, unknown>} variables - An object mapping variable names to their values.
 * @returns {PromptMessage} A new PromptMessage object with formatted content.
 * @throws {MissingPromptVariableError} If any required variables are missing from the variables object.
 */
export function formatPromptMessage(message: PromptMessage, variables: Record<string, unknown>): PromptMessage {
  return {
    role: message.role,
    content: formatPromptTemplate(message.content, variables),
  };
}
