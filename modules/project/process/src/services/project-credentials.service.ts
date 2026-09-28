import { randomBytes } from "node:crypto";

import { generate } from "@langwatch/ksuid";

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

/** The project's KSUID resource (`KSUID_RESOURCES.PROJECT`); older rows keep their nanoid ids. */
const PROJECT_KSUID_RESOURCE = "project";

/** Unbiased: a byte is masked to six bits and redrawn when it falls past the alphabet. */
function randomString({ alphabet, length }: { alphabet: string; length: number }): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      const index = byte & 63;
      if (index < alphabet.length && out.length < length) out += alphabet[index];
    }
  }
  return out;
}

export class ProjectCredentialsService extends ProjectCredentials {
  static create(): ProjectCredentialsService {
    return new ProjectCredentialsService();
  }

  private constructor() {
    super();
  }

  generateProjectId(): string {
    return generate(PROJECT_KSUID_RESOURCE).toString();
  }

  generateApiKey(): string {
    return `${API_KEY_PREFIX}${randomString({ alphabet: API_KEY_ALPHABET, length: API_KEY_CHARS })}`;
  }
}
