import { customAlphabet, nanoid } from "nanoid";

export abstract class ProjectCredentials {
  abstract generateProjectId(): string;
  abstract generateApiKey(): string;
}

/**
 * Credential constants (project ID, API key format) co-located to prevent
 * format drift across processes.
 */
const API_KEY_PREFIX = "sk-lw-";
const API_KEY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const API_KEY_CHARS = 48;

const randomApiKeyBody = customAlphabet(API_KEY_ALPHABET, API_KEY_CHARS);

export class ProjectCredentialsService extends ProjectCredentials {
  static create(): ProjectCredentialsService {
    return new ProjectCredentialsService();
  }

  private constructor() {
    super();
  }

  generateProjectId(): string {
    return nanoid();
  }

  generateApiKey(): string {
    return `${API_KEY_PREFIX}${randomApiKeyBody()}`;
  }
}
