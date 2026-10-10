import type { SaasBrowserScope, SaasBrowserUser } from "@langwatch/enterprise-saas-contract";

type PollCancel = () => void;

export class SaasBrowserAnalytics {
  private constructor(private readonly intervalMs: number) {}

  static create({ intervalMs }: { intervalMs?: number }): SaasBrowserAnalytics {
    return new SaasBrowserAnalytics(intervalMs ?? 200);
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
