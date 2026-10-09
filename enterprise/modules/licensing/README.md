# licensing

Licences: validating and storing a signed licence, the plan it grants, and the platform access and single sign-on gates it decides.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## At a glance

|                |                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Classification | enterprise (`modules/catalogue.json`)                                                                          |
| Subjects       | license, licensing                                                                                             |
| Halves         | [contract](contract) · [process](process/README.md) · [browser](browser) · [client](client)                    |
| Api token      | `LicensingApi` = `moduleApi<LicensingApi>()("licensing")`, `contract/src/licensing.api.ts:291` (58 operations) |
| Installed by   | api, worker, tasks (process); ui (browser)                                                                     |

## What licensing owns

| Kind                           | Name                                                                                                                                                                                                                                                                                                                                                                                                                      | Declared at                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Postgres table                 | `OrganizationLicense`                                                                                                                                                                                                                                                                                                                                                                                                     | `process/src/repositories/prisma/prisma.organization-license.repository.ts:42` |
| Postgres, accessed not claimed | `ActivationCode`, `InstanceIdentity`, `IssuedLicense`, `Organization`, `SelfHostedInstance`, `SelfHostedInstanceReport`                                                                                                                                                                                                                                                                                                   | `process/src/repositories/prisma/prisma.activation-code.repository.ts:15`      |
| Stores required                | prisma, encryption, rateLimiter                                                                                                                                                                                                                                                                                                                                                                                           | `process/src/repositories/live/live.licensing.repositories.ts:14`              |
| Secrets                        | `instanceLicenseKey` (LANGWATCH_LICENSE_KEY), `licensePrivateKey` (LANGWATCH_LICENSE_PRIVATE_KEY)                                                                                                                                                                                                                                                                                                                         | `process/src/app/licensing.app.ts:185`                                         |
| Config                         | `publicKey` (LANGWATCH_LICENSE_PUBLIC_KEY), `connectDisabled` (LANGWATCH_CONNECT_DISABLED), `connectGatewayEndpoint` (LANGWATCH_CONNECT_GATEWAY_ENDPOINT), `connectLicenseEndpoint` (LANGWATCH_CONNECT_LICENSE_ENDPOINT), `connectInstanceId` (LANGWATCH_CONNECT_INSTANCE_ID), `isSaas` (IS_SAAS), `serviceVersion` (SERVICE_VERSION), `otelResourceAttributes` (OTEL_RESOURCE_ATTRIBUTES), `outboundProxy` (HTTPS_PROXY) | `contract/src/licensing.config.ts:45`                                          |

Anything else licensing needs belongs to another module and is reached through its `*Api`.

## Peers (static dependencies)

| Name            | Token             | Module                                                  |
| --------------- | ----------------- | ------------------------------------------------------- |
| `gateway`       | `GatewayApi`      | [gateway](../../../modules/gateway/README.md)           |
| `instantEval`   | `InstantEvalApi`  | [instant-eval](../../../modules/instant-eval/README.md) |
| `organizations` | `OrganizationApi` | [organization](../../../modules/organization/README.md) |
| `scopes`        | `AuthzApi`        | [authz](../../../modules/authz/README.md)               |

## Who depends on licensing

[auth](../../../modules/auth/README.md), [billing](../billing/README.md), [enterprise-ops](../enterprise-ops/README.md), [entitlement](../../../modules/entitlement/README.md), [identity](../../../modules/identity/README.md), [ops](../../../modules/ops/README.md), [saas](../saas/README.md), [sso](../sso/README.md) (as a peer).

<!-- readme:generated:end -->
