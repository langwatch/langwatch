export class PromptFileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Local prompt file not found: ${filePath}`);
    this.name = 'PromptFileNotFoundError';
  }
}
