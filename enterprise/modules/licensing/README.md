# licensing

Licences: validating and storing a signed licence, the plan it grants, and the platform access and single sign-on gates it decides.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                          |
| Subjects       | license, licensing                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                    |
| Api token      | `LicensingApi` = `moduleApi<LicensingApi>()("licensing")`, `contract/src/licensing.api.ts:324` (64 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                     |

## What licensing owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Declared at                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Postgres table                 | `OrganizationLicense`                                                                                                                                                                                                                                                                                                                                                                                                                                  | `process/src/repositories/prisma/prisma.organization-license.repository.ts:56` |
| Postgres table                 | `SelfHostedInstanceDiagnostic`                                                                                                                                                                                                                                                                                                                                                                                                                         | `process/src/repositories/prisma/prisma.upgrade-diagnostic.repository.ts:20`   |
| Postgres, accessed not claimed | `ActivationCode`, `InstanceIdentity`, `IssuedLicense`, `Organization`, `SelfHostedInstance`, `SelfHostedInstanceReport`, `SignInProviderMount`                                                                                                                                                                                                                                                                                                         | `process/src/repositories/prisma/prisma.activation-code.repository.ts:16`      |
| Stores required                | prisma, encryption, rateLimiter, objectStorage                                                                                                                                                                                                                                                                                                                                                                                                         | `process/src/repositories/live/live.licensing.repositories.ts:16`              |
| Secrets                        | `instanceLicenseKey` (LANGWATCH_LICENSE_KEY), `licensePrivateKey` (LANGWATCH_LICENSE_PRIVATE_KEY), `upgradeDiagnosticsSlackWebhook` (SLACK_CHANNEL_UPGRADE_DIAGNOSTICS)                                                                                                                                                                                                                                                                                | `process/src/app/licensing.app.ts:174`                                         |
| Config                         | `publicKey` (LANGWATCH_LICENSE_PUBLIC_KEY), `connectDisabled` (LANGWATCH_CONNECT_DISABLED), `connectGatewayEndpoint` (LANGWATCH_CONNECT_GATEWAY_ENDPOINT), `connectLicenseEndpoint` (LANGWATCH_CONNECT_LICENSE_ENDPOINT), `connectInstanceId` (LANGWATCH_CONNECT_INSTANCE_ID), `isSaas` (IS_SAAS), `serviceVersion` (SERVICE_VERSION), `otelResourceAttributes` (OTEL_RESOURCE_ATTRIBUTES), `outboundProxy` (HTTPS_PROXY), `publicBaseUrl` (BASE_HOST) | `contract/src/licensing.config.ts:46`                                          |

Anything else licensing needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

None: licensing declares no peers.

## Who depends on licensing

[billing](../billing/README.md), [connect](../connect/README.md), [enterprise-ops](../enterprise-ops/README.md), [entitlement](../../../modules/entitlement/README.md), [gateway](../../../modules/gateway/README.md), [identity](../../../modules/identity/README.md), [ops](../../../modules/ops/README.md), [saas](../saas/README.md), [sso](../sso/README.md) (as a peer).

<!-- readme:generated:end -->
