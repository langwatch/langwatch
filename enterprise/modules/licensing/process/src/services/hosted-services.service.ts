/**
 * Licensing's half of the hosted end of Connect (ADR-156 §5): which active license
 * a managed key runs under. The hosted routes themselves are the connect module's.
 */

import {
  entitledConnectServices,
  type ConnectService,
} from "@langwatch/enterprise-licensing-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import { statusOfIssuedLicense } from "../rules/issued-license.rules.ts";

interface HostedServicesCollaborators {
  licenses: Pick<IssuedLicenseRepository, "findByVirtualKeyId">;
  now?: () => Instant;
}

export class HostedServicesService {
  static create(collaborators: HostedServicesCollaborators): HostedServicesService {
    return new HostedServicesService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: HostedServicesCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

  /**
   * The active license of this organization that holds the key, with the services it
   * is entitled to; empty for a plain virtual key, another customer's license, or one
   * that is no longer active. State is read on every call, never cached.
   */
  async findManagedKeyLicense({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{ services: ConnectService[] }[]> {
    const license = await this.collaborators.licenses.findByVirtualKeyId(virtualKeyId);
    if (!license || license.organizationId !== organizationId) return [];
    if (statusOfIssuedLicense(license, this.#now()) !== "active") return [];
    return [{ services: entitledConnectServices(license.services) }];
  }
}
