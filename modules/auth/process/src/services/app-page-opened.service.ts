import type { AppPage } from "@langwatch/auth-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

type AppPageOpenedDependencies = Readonly<{
  organizations: Pick<OrganizationApi, "countMembershipsForUser">;
  lifecycle: { appPageOpened(input: { userId: string; page: AppPage }): void };
  reportError: (error: unknown) => void;
}>;

/**
 * Announces a page open as auth's fact: only a browser login session (a CLI device login or an
 * API key carries none) of a person who belongs to an organization. A failure is reported, never
 * thrown: the page opens whether or not it was announced.
 */
export class AppPageOpenedService {
  static create(dependencies: AppPageOpenedDependencies): AppPageOpenedService {
    return new AppPageOpenedService(dependencies);
  }

  private constructor(private readonly dependencies: AppPageOpenedDependencies) {}

  async record(input: {
    userId: string;
    browserSessionId: string | null;
    page: AppPage;
    /** Set when an operator acts as this person: their browsing is not the person's. */
    impersonatorId?: string | undefined;
  }): Promise<void> {
    if (input.browserSessionId === null || input.impersonatorId !== undefined) return;
    try {
      const memberships = await this.dependencies.organizations.countMembershipsForUser({
        userId: input.userId,
      });
      if (memberships === 0) return;
      this.dependencies.lifecycle.appPageOpened({ userId: input.userId, page: input.page });
    } catch (error) {
      this.dependencies.reportError(error);
    }
  }
}
