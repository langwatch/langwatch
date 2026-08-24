import type {
  AdminIdentity,
  StartImpersonationInput,
  StopImpersonationInput,
} from "./admin.contract";

export abstract class AdminAccess {
  abstract isAdmin(identity: AdminIdentity): boolean;
  abstract emails(): readonly string[];
}

export abstract class AdminImpersonation {
  abstract start(input: StartImpersonationInput): Promise<void>;
  abstract stop(input: StopImpersonationInput): Promise<void>;
}

/** Portable Admin capability exposed to Enterprise composition roots. */
export abstract class AdminService {
  abstract readonly access: AdminAccess;
  abstract readonly impersonation: AdminImpersonation;
}

export type AdminRuntime = AdminService;
