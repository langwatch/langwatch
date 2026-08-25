import {
  OpsService as OpsServiceContract,
  type AdminIdentity,
  type StartImpersonationInput,
  type StopImpersonationInput,
} from "@langwatch/ops-contract";
import type { AdminAccess } from "./admin-access.service";
import type { ImpersonationService } from "./impersonation.service";

export class OpsService extends OpsServiceContract {
  private constructor(
    private readonly access: AdminAccess,
    private readonly impersonation: ImpersonationService,
  ) {
    super();
  }

  static create(options: {
    access: AdminAccess;
    impersonation: ImpersonationService;
  }): OpsService {
    return new OpsService(options.access, options.impersonation);
  }

  isAdmin(identity: AdminIdentity): boolean {
    return this.access.isAdmin(identity);
  }

  adminEmails(): readonly string[] {
    return this.access.emails();
  }

  startImpersonation(input: StartImpersonationInput): Promise<void> {
    return this.impersonation.start(input);
  }

  stopImpersonation(input: StopImpersonationInput): Promise<void> {
    return this.impersonation.stop(input);
  }
}
