/**
 * Data Privacy's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` host service, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiDeployment,
  useUiHostServices,
  useUiScope,
  type UiFeedback,
  type UiRoute,
} from "@langwatch/browser-host/capabilities";
import type { ReactNode } from "react";

import {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyBillingCurrencyReading,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyLicence,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "../model/data-privacy-host.ts";
import { billingCurrencyOf, mayReadSubscriptionPlan } from "../model/privacy-billing-currency.ts";
import { licenceOf, mayReadPlan } from "../model/privacy-licence.ts";
import { dataPrivacyApi } from "./data-privacy-api.ts";

class HostServiceDataPrivacyHost extends DataPrivacyHostApi {
  constructor(
    private readonly deps: {
      scope: PrivacyHostScope;
      route: UiRoute;
      feedback: UiFeedback;
      licence: PrivacyLicence;
      mayManageLicence: boolean;
      billingCurrency: PrivacyBillingCurrencyReading;
      readPlanAgain: () => Promise<unknown>;
    },
  ) {
    super();
  }

  scope(): PrivacyHostScope {
    return this.deps.scope;
  }

  route(): PrivacyRouteReading {
    const reading = this.deps.route.reading();
    return { params: reading.params, query: reading.query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.route.setQuery(next, options);
  }

  succeeded(notice: PrivacySuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: PrivacyFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  licence(): PrivacyLicence {
    return this.deps.licence;
  }

  mayManageLicence(): boolean {
    return this.deps.mayManageLicence;
  }

  billingCurrency(): PrivacyBillingCurrencyReading {
    return this.deps.billingCurrency;
  }

  async refreshBillingCurrency(): Promise<void> {
    await this.deps.readPlanAgain();
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function DataPrivacyHostMount({ children }: { children?: ReactNode }) {
  const { feedback, route, session } = useUiHostServices();
  const { isSaaS } = useUiDeployment();
  const uiScope = useUiScope();
  const { organizationId, projectId } = uiScope.activeScope();
  const teamId = uiScope.scopeHost()?.team()?.id;
  const planReader = {
    isSaaS,
    organizationId: organizationId ?? void 0,
    canViewOrganization: session.hasPermission("organization:view"),
  };
  // Self-hosted the plan is the licence the model comes with; on Cloud, the price's currency.
  const mayRead = mayReadPlan(planReader);
  const mayReadCurrency = mayReadSubscriptionPlan(planReader);
  const plan = dataPrivacyApi.plan.getActivePlan.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: mayRead || mayReadCurrency, retry: false },
  );
  const licence = licenceOf({ mayRead, plan });
  const billingCurrency = billingCurrencyOf({ mayRead: mayReadCurrency, plan });
  const mayManageLicence = session.hasPermission("organization:manage");

  const host = new HostServiceDataPrivacyHost({
    scope: { organizationId: organizationId ?? void 0, teamId, projectId: projectId ?? void 0 },
    route,
    feedback,
    licence,
    mayManageLicence,
    billingCurrency,
    readPlanAgain: () => plan.refetch(),
  });
  return <DataPrivacyHostProvider value={host}>{children}</DataPrivacyHostProvider>;
}
