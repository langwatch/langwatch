import {
  AdminAccess,
  type AdminIdentity,
} from "@langwatch/enterprise-admin-contract";

export interface AdminAccessServiceOptions {
  adminEmails: string | readonly string[];
}

export class AdminAccessService extends AdminAccess {
  private readonly normalizedEmails: readonly string[];

  private constructor(options: AdminAccessServiceOptions) {
    super();
    this.normalizedEmails = AdminAccessService.parseEmails(options.adminEmails);
  }

  static create(options: AdminAccessServiceOptions): AdminAccessService {
    return new AdminAccessService(options);
  }

  static parseEmails(value: string | readonly string[]): string[] {
    const values = typeof value === "string" ? value.split(",") : value;
    return values
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0);
  }

  isAdmin(identity: AdminIdentity): boolean {
    if (!identity.email) return false;
    return this.normalizedEmails.includes(identity.email.trim().toLowerCase());
  }

  emails(): readonly string[] {
    return this.normalizedEmails;
  }
}
