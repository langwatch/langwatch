import { EnterpriseCatalogue } from "@langwatch/enterprise";

/** Worker-only Enterprise composition shell. No worker feature is installed yet. */
export class EnterpriseWorkerComposition {
  private constructor(readonly catalogue: EnterpriseCatalogue) {}

  static create(): EnterpriseWorkerComposition {
    return new EnterpriseWorkerComposition(EnterpriseCatalogue.create());
  }
}
