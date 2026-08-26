// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";
import {
  AiToolProviderCatalogPort,
  AiToolSlugPort,
  CliAdminContactPort,
  PersonalVirtualKeyIssuerPort,
} from "@langwatch/enterprise-governance-server";
import { nanoid } from "nanoid";

type VirtualKeyWithScopes = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  displayPrefix: string;
  status: string;
  principalUserId: string | null;
  routingPolicyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastUsedAt: Date | null;
  scopes: Array<{
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
};

export type GovernanceVirtualKeyPort = {
  create(input: {
    organizationId: string;
    name: string;
    description: string;
    principalUserId: string;
    actorUserId: string;
    scopes: Array<{ scopeType: "PROJECT"; scopeId: string }>;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: VirtualKeyWithScopes; secret: string }>;
  revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<VirtualKeyWithScopes>;
};

export type GovernanceModelProviderCatalogPort = {
  list(): Array<{ providerKey: string; displayName: string; type: string }>;
};

export type GovernanceOrganizationContactPort = {
  tryResolveAdminEmail(organizationId: string): Promise<string | null>;
};

export class AppPersonalVirtualKeyIssuerPort extends PersonalVirtualKeyIssuerPort {
  private constructor(private readonly virtualKeys: GovernanceVirtualKeyPort) {
    super();
  }

  static create(virtualKeys: GovernanceVirtualKeyPort): AppPersonalVirtualKeyIssuerPort {
    return new AppPersonalVirtualKeyIssuerPort(virtualKeys);
  }

  async issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }> {
    const issued = await this.virtualKeys.create({
      organizationId: input.organizationId,
      name: input.label,
      description: "Personal virtual key",
      principalUserId: input.userId,
      actorUserId: input.userId,
      scopes: [{ scopeType: "PROJECT", scopeId: input.personalProjectId }],
      routingPolicyId: input.routingPolicyId,
    });
    return {
      virtualKey: toPersonalVirtualKey(issued.virtualKey),
      secret: issued.secret,
    };
  }

  async revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey> {
    return toPersonalVirtualKey(await this.virtualKeys.revoke(input));
  }
}

export class AppAiToolSlugPort extends AiToolSlugPort {
  generate(displayName: string): string {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const stem = base.length > 0 ? base : "tool";
    return `${stem}-${nanoid(6)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "x")}`;
  }
}

export class AppAiToolProviderCatalogPort extends AiToolProviderCatalogPort {
  private constructor(private readonly providers: GovernanceModelProviderCatalogPort) {
    super();
  }

  static create(
    providers: GovernanceModelProviderCatalogPort,
  ): AppAiToolProviderCatalogPort {
    return new AppAiToolProviderCatalogPort(providers);
  }

  list(): Array<{
    providerKey: string;
    displayName: string;
    type: string;
  }> {
    return this.providers.list();
  }
}

export class AppCliAdminContactPort extends CliAdminContactPort {
  private constructor(private readonly contacts: GovernanceOrganizationContactPort) {
    super();
  }

  static create(contacts: GovernanceOrganizationContactPort): AppCliAdminContactPort {
    return new AppCliAdminContactPort(contacts);
  }

  tryResolveAdminEmail(organizationId: string): Promise<string | null> {
    return this.contacts.tryResolveAdminEmail(organizationId);
  }
}

function toPersonalVirtualKey(key: VirtualKeyWithScopes): PersonalVirtualKey {
  return {
    id: key.id,
    organizationId: key.organizationId,
    name: key.name,
    description: key.description,
    displayPrefix: key.displayPrefix,
    status: key.status,
    principalUserId: key.principalUserId,
    routingPolicyId: key.routingPolicyId,
    createdAtMs: key.createdAt.getTime(),
    updatedAtMs: key.updatedAt.getTime(),
    lastUsedAtMs: key.lastUsedAt?.getTime() ?? null,
    scopes: key.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
  };
}
