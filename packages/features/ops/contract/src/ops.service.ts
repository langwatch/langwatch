import type {
  AdminIdentity,
  StartImpersonationInput,
  StopImpersonationInput,
} from "./admin";

/** The single portable capability for platform operations and backoffice work. */
export abstract class OpsService {
  abstract isAdmin(identity: AdminIdentity): boolean;
  abstract adminEmails(): readonly string[];
  abstract startImpersonation(input: StartImpersonationInput): Promise<void>;
  abstract stopImpersonation(input: StopImpersonationInput): Promise<void>;
}
