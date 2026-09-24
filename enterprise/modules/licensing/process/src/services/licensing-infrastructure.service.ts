import type { RestIdentity } from "@langwatch/api/rest";
import type { SeatChangeBillingOutcome } from "@langwatch/enterprise-licensing-contract";

import type { LicensingInfrastructure } from "../app/licensing.app.ts";
import type {
  HostedServicesInfrastructure,
  LicenseRegistryInfrastructure,
  LicenseStorage,
  OrganizationLicenseReads,
  SelfHostedInstancesInfrastructure,
} from "../app/licensing.members.ts";

/**
 * What a process that composes less than the whole feature answers: the
 * live licence reads, and a refusal by process name for every port it did
 * not compose, never a silent "no licenses".
 */
export class LicensingInfrastructureService {
  static create({ processName }: { processName: string }): LicensingInfrastructureService {
    return new LicensingInfrastructureService(processName);
  }

  private constructor(private readonly processName: string) {}

  /** Seat counts are a peer's own repository: supplied by the caller, or refused. */
  withoutMutation(options: {
    licenses: OrganizationLicenseReads;
    getMemberCount?: (organizationId: string) => Promise<number>;
    getMembersLiteCount?: (organizationId: string) => Promise<number>;
  }): LicensingInfrastructure {
    const licenses = options.licenses;
    const unavailable = () => new Error(`${this.processName} does not compose license mutation`);
    const repository: LicenseStorage = {
      getOrganizationLicense: (organizationId) => licenses.getOrganizationLicense(organizationId),
      findOrganizationsWithLicense: () => licenses.findOrganizationsWithLicense(),
      organizationExists: () => Promise.reject(unavailable()),
      storeLicense: () => Promise.reject(unavailable()),
      removeLicense: () => Promise.reject(unavailable()),
      getMemberCount: options.getMemberCount ?? (() => Promise.reject(unavailable())),
      getMembersLiteCount: options.getMembersLiteCount ?? (() => Promise.reject(unavailable())),
    };
    return {
      repository,
      configuredAuthProvider: () => null,
      platformSsoAllowed: () => Promise.resolve(false),
      authProviderIsMounted: () => false,
      reportSigningFailure: () => void 0,
      checkLimit: () => Promise.reject(unavailable()),
      notifyLimitReached: () => Promise.reject(unavailable()),
      reportError: () => void 0,
    };
  }

  /** Only LangWatch Cloud composes the registry (ADR-156); an install has none. */
  unavailableRegistry(): LicenseRegistryInfrastructure {
    const unavailable = () =>
      new Error(`${this.processName} does not compose the license registry`);
    const refuse = () => Promise.reject(unavailable());
    return {
      repository: {
        create: refuse,
        findById: refuse,
        findByTokenHash: refuse,
        findByVirtualKeyId: refuse,
        findByReplacesId: refuse,
        findAllByOrganization: () => Promise.resolve([]),
        findAllBoundToInstance: () => Promise.resolve([]),
        findAll: () => Promise.resolve({ rows: [], total: 0 }),
        update: refuse,
        bindInstance: refuse,
        attachVirtualKey: refuse,
      },
      organizations: {
        findById: refuse,
        createSelfHostedCustomer: refuse,
        markSelfHostedCustomer: refuse,
      },
      managedKeys: {
        provision: refuse,
        retire: refuse,
        invalidate: refuse,
        setConnectServices: refuse,
        setLicense: refuse,
      },
      activationCodes: {
        create: refuse,
        findByCodeHash: refuse,
        findById: refuse,
        findAll: () => Promise.resolve({ rows: [], total: 0 }),
        claimSingleUse: refuse,
        recordReusableRedemption: refuse,
        attachIssuedLicense: refuse,
        releaseClaim: refuse,
        revoke: refuse,
      },
      activationRateLimit: { allow: () => Promise.resolve(false) },
      seatBilling: {
        invoiceAddedSeats: (): Promise<SeatChangeBillingOutcome> =>
          Promise.resolve("not_onboarded"),
      },
      syncRateLimit: { allow: () => Promise.resolve(false) },
      cipher: {
        encrypt: () => {
          throw unavailable();
        },
        decrypt: () => {
          throw unavailable();
        },
      },
      signingKey: () => undefined,
      systemActorId: "system",
    };
  }

  /** Every hosted collaborator refuses rather than reading as "entitled to nothing". */
  unavailableHostedServices(): HostedServicesInfrastructure & { door: RestIdentity } {
    const unavailable = () =>
      new Error(`${this.processName} does not compose the hosted Connect services`);
    const refuse = () => Promise.reject(unavailable());
    return {
      budgets: { findForOrganization: refuse, create: refuse, setLimit: refuse, reset: refuse },
      usage: { read: refuse },
      judge: {
        classify: refuse,
        priceOf: () => {
          throw unavailable();
        },
      },
      spend: { recordSpend: refuse },
      door: this.unavailableHostedDoor(),
    };
  }

  /** The instance registry the usage report receiver writes, on Cloud only. */
  unavailableSelfHostedInstances(): SelfHostedInstancesInfrastructure {
    const refuse = () =>
      Promise.reject(
        new Error(`${this.processName} does not compose the self-hosted instance registry`),
      );
    return {
      repository: {
        upsert: refuse,
        appendReport: refuse,
        findPage: refuse,
        getById: refuse,
        findByInstanceId: refuse,
        findReports: refuse,
      },
      optionalReportKeys: new Set(),
    };
  }

  /** A call reaching the path is refused by name, not by a missing credential binding. */
  private unavailableHostedDoor(): RestIdentity {
    const refuse = (): never => {
      throw new Error(`${this.processName} does not compose the hosted Connect door`);
    };
    return { authenticate: refuse, identify: refuse, identifyOptional: refuse, authorize: refuse };
  }
}
