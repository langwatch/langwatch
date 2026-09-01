import { customAlphabet, nanoid } from "nanoid";
import { ProjectCredentialsPort } from "../ports/project.port";

/**
 * The identifier and the ingestion credential a project is born with.
 *
 * Both are persisted formats a customer keeps: the project id is a bare
 * nanoid, and the write key is `sk-lw-` followed by 48 alphanumeric
 * characters — 54 bytes in total, which is the length the onboarding snippets
 * are sized against. The alphabet deliberately excludes nanoid's `-` and `_`
 * so a key survives being double-clicked, pasted into a shell, or written into
 * a URL.
 *
 * These lived in the platform application, which meant any second process
 * composing a ProjectService had to restate them. Restating a credential
 * format is how one process starts minting keys another process's parser
 * rejects.
 */
const API_KEY_PREFIX = "sk-lw-";
const API_KEY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const API_KEY_CHARS = 48;

const randomApiKeyBody = customAlphabet(API_KEY_ALPHABET, API_KEY_CHARS);

export class ProjectCredentialsAdapter extends ProjectCredentialsPort {
  static create(): ProjectCredentialsAdapter {
    return new ProjectCredentialsAdapter();
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
