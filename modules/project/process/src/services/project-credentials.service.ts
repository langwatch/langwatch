import { generate } from "@langwatch/ksuid";

import { REVOKED_LEGACY_KEY_PREFIX } from "../rules/legacy-project-key.rules.ts";

export abstract class ProjectCredentials {
  abstract generateProjectId(): string;
  abstract generateApiKey(): string;
}

/** The project's KSUID resource (`KSUID_RESOURCES.PROJECT`); older rows keep their nanoid ids. */
const PROJECT_KSUID_RESOURCE = "project";

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

  /**
   * The legacy key is never minted (ADR-002): the required, unique column holds
   * a value no door resolves.
   */
  generateApiKey(): string {
    return `${REVOKED_LEGACY_KEY_PREFIX}${generate(PROJECT_KSUID_RESOURCE).toString()}`;
  }
}
