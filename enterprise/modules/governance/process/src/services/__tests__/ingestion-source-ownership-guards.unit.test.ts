// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Buffer } from "node:buffer";

import type {
  CreateGovernanceIngestionSourceCommand,
  GovernanceIngestionSourceType,
} from "@langwatch/enterprise-governance-contract";
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { TestProjectApi } from "../../__tests__/support/test-project-api.ts";
import type {
  GovernanceDiagnosticsSink,
  GovernanceEncryptor,
  IngestionSourceEntitlements,
  IngestionSourceLifecycleChannel,
} from "../../app/governance.members.ts";
import { MemoryProviderAccountChannel } from "../../channels/memory/memory.provider-account.channel.ts";
import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import { IngestionCredentialsService } from "../ingestion-credentials.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../ingestion-source-secret.service.ts";
import { IngestionSourceService } from "../ingestion-source.service.ts";
import { PullDestinationService } from "../pull-destination.service.ts";

const ORG = "org-1";
const SUBSCRIPTION = "aaaaaaaa-0000-4000-8000-000000000001";
const ENVIRONMENT = "https://contoso.crm.dynamics.com";
const ACCOUNT = "org_test_anthropic_0001";
const OTHER_ACCOUNT = "org_test_anthropic_0002";
const FIRST_KEY = "sk-ant-admin-FIRSTKEY-0000000000";
const SECOND_KEY = "sk-ant-admin-SECONDKEY-000000000";
const UNKNOWN_KEY = "sk-ant-admin-UNKNOWN-00000000000";

class Base64Encryption implements GovernanceEncryptor {
  encrypt(value: string): string {
    return Buffer.from(value).toString("base64url");
  }
  decrypt(value: string): string {
    return Buffer.from(value, "base64url").toString();
  }
}

class GovernanceProjects extends TestProjectApi {
  override async ensureInternal(_input: InternalProjectQuery): Promise<InternalProject> {
    return {
      id: "gov-project",
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
    };
  }
}

class Enterprise implements IngestionSourceEntitlements {
  async hasEnterprisePlan(): Promise<boolean> {
    return true;
  }
}

class NoLifecycle implements IngestionSourceLifecycleChannel {
  async sync(): Promise<void> {}
}

class NoDiagnostics implements GovernanceDiagnosticsSink {
  warn(): void {}
}

function harness() {
  const credentials = IngestionCredentialsService.create(new Base64Encryption());
  const repository = MemoryIngestionSourceRepository.create();
  const providerAccounts = MemoryProviderAccountChannel.create({
    accountsByKey: { [FIRST_KEY]: ACCOUNT, [SECOND_KEY]: ACCOUNT, "sk-other": OTHER_ACCOUNT },
    credentials,
  });
  const service = IngestionSourceService.create({
    repository,
    projects: new GovernanceProjects(),
    entitlements: new Enterprise(),
    lifecycle: new NoLifecycle(),
    credentials,
    secrets: IngestionSecretService.create(
      IngestionSecretConfiguration.create({ pepper: "pepper" }),
    ),
    destinations: PullDestinationService.create(),
    providerAccounts,
    diagnostics: new NoDiagnostics(),
  });

  const create = async (
    name: string,
    sourceType: GovernanceIngestionSourceType,
    parserConfig: Record<string, unknown>,
  ) =>
    (
      await service.createSource({
        organizationId: ORG,
        sourceType,
        name,
        actorUserId: "user-1",
        parserConfig,
      } satisfies CreateGovernanceIngestionSourceCommand)
    ).source;

  return { service, repository, providerAccounts, create };
}

const azureBill = (subscription: string) => ({
  azureSubscriptionId: subscription,
  credentials: {
    tenantId: "tenant",
    clientId: "client",
    clientSecret: "secret",
    billingClientId: "billing-client",
    billingClientSecret: "billing-secret",
  },
});

const adminKey = (token: string, report: "usage" | "cost") => ({
  adapter: "anthropic_admin",
  report,
  credentials: { token },
});

async function refusalOf(
  promise: Promise<unknown>,
): Promise<{ code?: string; formErrors: string[] }> {
  const thrown: unknown = await promise.then(
    () => {
      throw new Error("expected the save to be refused");
    },
    (error: unknown) => error,
  );
  const code = thrown instanceof Error && "code" in thrown ? String(thrown.code) : undefined;
  const meta = thrown instanceof Error && "meta" in thrown ? thrown.meta : undefined;
  const formErrors =
    meta !== null &&
    typeof meta === "object" &&
    "formErrors" in meta &&
    Array.isArray(meta.formErrors)
      ? meta.formErrors.map(String)
      : [];

  return { code, formErrors };
}

describe("IngestionSourceService ownership guards", () => {
  describe("given a source already reading an Azure subscription's bill", () => {
    /** @scenario "A second connection to a subscription another connection reads is refused" */
    it("refuses creating a second source on a subscription another source reads", async () => {
      const { create } = harness();
      await create("Contoso bill", "copilot_studio_dataverse", azureBill(SUBSCRIPTION));

      const refusal = await refusalOf(
        create("Second bill", "copilot_studio_dataverse", azureBill(SUBSCRIPTION.toUpperCase())),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).toContain("Contoso bill");
    });

    it("refuses an edit that points a source at a subscription another source reads", async () => {
      const { service, create } = harness();
      await create("Contoso bill", "copilot_studio_dataverse", azureBill(SUBSCRIPTION));
      const second = await create("Second", "copilot_studio_dataverse", {});

      const refusal = await refusalOf(
        service.updateSource({
          id: second.id,
          organizationId: ORG,
          parserConfig: azureBill(SUBSCRIPTION),
        }),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).toContain("Contoso bill");
    });

    /** @scenario "A subscription cannot be saved without its own billing credential" */
    it("asks for the bill's own credential before looking for another reader", async () => {
      const { create } = harness();
      await create("Contoso bill", "copilot_studio_dataverse", azureBill(SUBSCRIPTION));

      const refusal = await refusalOf(
        create("No pair", "copilot_studio_dataverse", {
          azureSubscriptionId: SUBSCRIPTION,
          credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
        }),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).not.toContain("Contoso bill");
    });

    /** @scenario "A replacement Azure source restates the original bill" */
    it("files a replacement source's bill under the source that first read it", async () => {
      const { service, create } = harness();
      const first = await create(
        "Contoso bill",
        "copilot_studio_dataverse",
        azureBill(SUBSCRIPTION),
      );
      await service.archive({ id: first.id, organizationId: ORG });

      const replacement = await create(
        "Replacement",
        "copilot_studio_dataverse",
        azureBill(SUBSCRIPTION),
      );

      expect(replacement.parserConfig._azureBillSourceId).toBe(first.id);
    });

    it("keeps the bill's identity through an edit that resends the same subscription", async () => {
      const { service, create } = harness();
      const first = await create(
        "Contoso bill",
        "copilot_studio_dataverse",
        azureBill(SUBSCRIPTION),
      );
      await service.archive({ id: first.id, organizationId: ORG });
      const replacement = await create(
        "Replacement",
        "copilot_studio_dataverse",
        azureBill(SUBSCRIPTION),
      );

      const edited = await service.updateSource({
        id: replacement.id,
        organizationId: ORG,
        parserConfig: { azureSubscriptionId: SUBSCRIPTION },
      });

      expect(edited.parserConfig._azureBillSourceId).toBe(first.id);
      expect(edited.parserConfig._azureBillSubscriptionId).toBe(SUBSCRIPTION);
    });
  });

  describe("given a source already reading a conversation environment", () => {
    /** @scenario "A second connection to an environment another connection reads is refused" */
    it("refuses creating and editing a second source onto an environment another source reads", async () => {
      const { service, create } = harness();
      await create("Contoso conversations", "copilot_studio_dataverse", {
        environmentUrl: ENVIRONMENT,
      });
      const second = await create("Second", "copilot_studio_dataverse", {});

      const created = await refusalOf(
        create("Duplicate", "copilot_studio_dataverse", { environmentUrl: `${ENVIRONMENT}/` }),
      );
      const edited = await refusalOf(
        service.updateSource({
          id: second.id,
          organizationId: ORG,
          parserConfig: { environmentUrl: ENVIRONMENT },
        }),
      );

      expect([created.code, edited.code]).toEqual(["validation_error", "validation_error"]);
      expect(created.formErrors[0]).toContain("Contoso conversations");
      expect(edited.formErrors[0]).toContain("Contoso conversations");
    });

    it("lets an environment go once the source reading it is archived", async () => {
      const { service, create } = harness();
      const first = await create("Contoso conversations", "copilot_studio_dataverse", {
        environmentUrl: ENVIRONMENT,
      });
      await service.archive({ id: first.id, organizationId: ORG });

      await expect(
        create("Replacement", "copilot_studio_dataverse", { environmentUrl: ENVIRONMENT }),
      ).resolves.toMatchObject({ name: "Replacement" });
    });
  });

  describe("given a connection already reading a provider account", () => {
    /** @scenario "A second connection reading the same report from an account already connected is refused" */
    it("refuses a second connection with the same key for the same report", async () => {
      const { create } = harness();
      await create("Anthropic spend", "anthropic_admin", adminKey(FIRST_KEY, "cost"));

      const refusal = await refusalOf(
        create("Again", "anthropic_admin", adminKey(FIRST_KEY, "cost")),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).toContain("Anthropic spend");
    });

    /** @scenario "A second key belonging to an account already connected is refused" */
    it("refuses a different key the provider says belongs to the same account", async () => {
      const { create } = harness();
      await create("Anthropic spend", "anthropic_admin", adminKey(FIRST_KEY, "cost"));

      const refusal = await refusalOf(
        create("Rotated", "anthropic_admin", adminKey(SECOND_KEY, "cost")),
      );

      expect(refusal.code).toBe("validation_error");
    });

    /** @scenario "A usage connection and a cost connection may read the same account" */
    it("accepts a usage connection and a cost connection on one account", async () => {
      const { create } = harness();
      await create("Anthropic usage", "anthropic_admin", adminKey(FIRST_KEY, "usage"));

      await expect(
        create("Anthropic spend", "anthropic_admin", adminKey(SECOND_KEY, "cost")),
      ).resolves.toMatchObject({ name: "Anthropic spend" });
    });

    /** @scenario "A connection whose account the provider will not confirm is not saved" */
    it("refuses a key the provider will not confirm, and stores nothing", async () => {
      const { service, create } = harness();

      const refusal = await refusalOf(
        create("Unknown", "anthropic_admin", adminKey(UNKNOWN_KEY, "cost")),
      );

      expect(refusal.code).toBe("validation_error");
      await expect(service.list(ORG)).resolves.toEqual([]);
    });

    /** @scenario "A disabled connection still holds the account it read" */
    it("still refuses while the connection holding the account is only switched off", async () => {
      const { service, create } = harness();
      const first = await create("Anthropic spend", "anthropic_admin", adminKey(FIRST_KEY, "cost"));
      await service.updateSource({ id: first.id, organizationId: ORG, status: "disabled" });

      const refusal = await refusalOf(
        create("Again", "anthropic_admin", adminKey(SECOND_KEY, "cost")),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).toContain("Anthropic spend");
    });

    /** @scenario "An edit that points a connection at an account another connection reads is refused" */
    it("refuses an edit whose new key belongs to an account another connection reads", async () => {
      const { service, create } = harness();
      await create("Anthropic spend", "anthropic_admin", adminKey(FIRST_KEY, "cost"));
      const other = await create("Other spend", "anthropic_admin", adminKey("sk-other", "cost"));

      const refusal = await refusalOf(
        service.updateSource({
          id: other.id,
          organizationId: ORG,
          parserConfig: adminKey(SECOND_KEY, "cost"),
        }),
      );

      expect(refusal.code).toBe("validation_error");
      expect(refusal.formErrors[0]).toContain("Anthropic spend");
    });

    /** @scenario "Saving a connection without changing the account it reads is allowed" */
    it("saves an edit that keeps the stored key, without colliding with itself", async () => {
      const { service, providerAccounts, create } = harness();
      const first = await create("Anthropic spend", "anthropic_admin", adminKey(FIRST_KEY, "cost"));

      await expect(
        service.updateSource({
          id: first.id,
          organizationId: ORG,
          name: "Renamed",
          parserConfig: { adapter: "anthropic_admin", report: "cost" },
        }),
      ).resolves.toMatchObject({ name: "Renamed" });
      expect(providerAccounts.asked).toHaveLength(2);
    });
  });
});
