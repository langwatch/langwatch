import type {
  SaasBrowserScope,
  SaasBrowserUser,
} from "@langwatch/enterprise-saas-contract";

type PollCancel = () => void;

export type PostHogIdentify = (
  distinctId: string,
  properties: Record<string, unknown>,
) => void;

export class SaasBrowserAnalytics {
  private constructor(
    private readonly identifyPostHog: PostHogIdentify,
    private readonly intervalMs: number,
  ) {}

  static create(options: {
    identifyPostHog: PostHogIdentify;
    intervalMs?: number;
  }): SaasBrowserAnalytics {
    return new SaasBrowserAnalytics(
      options.identifyPostHog,
      options.intervalMs ?? 200,
    );
  }

  identifyPostHogUser(input: {
    user: SaasBrowserUser;
    organization?: SaasBrowserScope;
    project?: SaasBrowserScope;
  }): void {
    this.identifyPostHog(input.user.id, {
      email: input.user.email,
      name: input.user.name,
      organization_id: input.organization?.id,
      organization_name: input.organization?.name,
      project_id: input.project?.id,
      project_name: input.project?.name,
    });
  }

  identifyReo(input: {
    user: SaasBrowserUser;
    organization: SaasBrowserScope;
    onIdentified: () => void;
  }): PollCancel {
    return this.poll(
      () => (window as Window & { Reo?: { identify?: (value: unknown) => void } }).Reo,
      (reo) => {
        if (!reo.identify || !input.user.email) return;
        reo.identify({
          username: input.user.email,
          type: "email",
          firstname: input.user.name ?? "",
          company: input.organization.name,
        });
        input.onIdentified();
      },
    );
  }

  trackDashboardOpen(input: {
    user: SaasBrowserUser;
    organization: SaasBrowserScope;
    project: SaasBrowserScope;
    environment: string;
  }): PollCancel {
    return this.poll(
      () => (window as Window & { gtag?: (...args: unknown[]) => void }).gtag,
      (gtag) => {
        const properties = {
          organization_id: input.organization.id,
          organization_name: input.organization.name,
          project_id: input.project.id,
          project_name: input.project.name,
          environment: input.environment,
          user_id: input.user.id,
        };
        gtag("set", "user_properties", properties);
        gtag("event", "open_dashboard", properties);
      },
    );
  }

  private poll<T>(read: () => T | undefined, consume: (value: T) => void): PollCancel {
    const current = read();
    if (current !== undefined) {
      consume(current);
      return () => undefined;
    }
    const interval = window.setInterval(() => {
      const value = read();
      if (value === undefined) return;
      window.clearInterval(interval);
      consume(value);
    }, this.intervalMs);
    return () => window.clearInterval(interval);
  }
}
