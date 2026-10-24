/**
 * The model provider a seeded organization connects, and the model Langy
 * answers from (README.md "seed-provider.ts"). The account, organization and
 * project it attaches to are seeded in seed-organization.ts.
 */

import { execFileSync } from "node:child_process";

import {
  getProviderModelOptions,
  pickRecommendedChatModel,
} from "@langwatch/model-provider-contract";

import {
  GUIDED_PROVIDERS,
  type GuidedProvider,
} from "../../src/shell/features/guided-onboarding/model/guided-providers.ts";
import { openaiKey } from "./local-control-fixture";
import { trpcMutate, trpcQuery } from "./trpc";

/** The provider the seeded org connects (README.md "guided-onboarding-fixture.ts"). */
export const PROVIDER = (process.env.LANGY_GUIDED_PROVIDER ?? "openai") as GuidedProvider["id"];

/** The model LANGY answers from, not the org's (README.md "guided-onboarding-fixture.ts"). */
const LANGY_MODEL = process.env.LANGY_MODEL ?? "";

/** Reads a required environment variable, or throws naming the provider that needs it. */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is required with LANGY_GUIDED_PROVIDER=${PROVIDER}; the run script exports it from the workspace-root .env`,
    );
  }
  return value;
}

/** The Azure OpenAI endpoint of the resource named in AZURE_RESOURCE_NAME. */
export const azureBaseUrl = (): string =>
  `https://${requiredEnv("AZURE_RESOURCE_NAME")}.openai.azure.com`;

/** At most this many chat model pills: the recommended one and the next few. */
const GUIDED_MODEL_PILLS_MAX = 4;

/** Chat model pills, real catalog (README.md "guided-onboarding-fixture.ts"). */
function guidedChatModels(provider: GuidedProvider): string[] {
  const backend = provider.registryKey === "openai_codex" ? "openai" : provider.registryKey;
  const catalog = getProviderModelOptions(backend, "chat").map((option) => option.value);
  const recommended = pickRecommendedChatModel(backend)?.slice(backend.length + 1);
  const ordered = recommended
    ? [recommended, ...catalog.filter((m) => m !== recommended)]
    : catalog;
  return ordered.slice(0, GUIDED_MODEL_PILLS_MAX);
}

/** The model the provider screen lands on (README.md "guided-onboarding-fixture.ts"). */
export const MODEL =
  PROVIDER === "azure"
    ? requiredEnv("AZURE_DEPLOYMENT")
    : guidedChatModels(GUIDED_PROVIDERS.find((provider) => provider.id === PROVIDER)!)[0]!;

/** The provider the takeover connects (README.md "guided-onboarding-fixture.ts"). */
export async function attachProvider({
  cookie,
  organizationId,
  projectId,
  openaiBaseUrl,
}: {
  cookie: string;
  organizationId: string;
  projectId: string;
  /** A gateway virtual key stands in for an OpenAI key when this names its gateway. */
  openaiBaseUrl?: string;
}): Promise<void> {
  let customKeys: Record<string, string>;
  if (PROVIDER === "azure") {
    customKeys = {
      AZURE_OPENAI_ENDPOINT: azureBaseUrl(),
      AZURE_OPENAI_API_KEY: requiredEnv("AZURE_API_KEY"),
    };
  } else {
    const key = openaiKey();
    if (!key) {
      throw new Error(
        "no OPENAI_API_KEY in the environment or the workspace-root .env; the seeded provider needs one",
      );
    }
    customKeys = {
      OPENAI_API_KEY: key,
      ...(openaiBaseUrl ? { OPENAI_BASE_URL: openaiBaseUrl } : {}),
    };
  }
  await trpcMutate({
    cookie,
    path: "modelProvider.update",
    input: {
      organizationId,
      projectId,
      provider: PROVIDER,
      enabled: true,
      customKeys,
      defaultModel: MODEL,
      scopes: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    },
  });
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "LANGY",
      model: `${PROVIDER}/${MODEL}`,
    },
  });
  // Everything not Langy runs on DEFAULT (README.md "guided-onboarding-fixture.ts").
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "DEFAULT",
      model: `${PROVIDER}/${MODEL}`,
    },
  });
  await trpcMutate({
    cookie,
    path: "onboarding.recordProvider",
    input: { organizationId, provider: PROVIDER, model: MODEL },
  });
  if (LANGY_MODEL) await pointLangyAt({ cookie, organizationId });
  // Both keys, different questions (README.md "guided-onboarding-fixture.ts").
  for (const featureKey of ["langy", "scenarios.user_simulator"]) {
    const resolved = await trpcQuery<unknown>({
      cookie,
      path: "modelProvider.getResolvedDefault",
      input: { projectId, featureKey },
    });
    console.log(`[seed-provider] ${featureKey} resolves to ${JSON.stringify(resolved)}`);
  }
}

/** Gives the org the provider behind LANGY_MODEL (README.md "guided-onboarding-fixture.ts"). */
async function pointLangyAt({
  cookie,
  organizationId,
}: {
  cookie: string;
  organizationId: string;
}): Promise<void> {
  const provider = LANGY_MODEL.split("/")[0] ?? "";
  if (!provider) {
    throw new Error(`LANGY_MODEL=${LANGY_MODEL} is not provider/model`);
  }
  copyProviderRow({ provider, organizationId });
  await trpcMutate({
    cookie,
    path: "modelProvider.setRoleAssignmentForScope",
    input: {
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      role: "LANGY",
      model: LANGY_MODEL,
    },
  });
  console.log(`[seed-provider] langy answers from ${LANGY_MODEL}`);
}

/** Where the copy reads from and writes to. */
const PG_URL = process.env.LANGWATCH_PG_URL ?? "postgresql://postgres@localhost:5432/langwatch_db";

/** Copies a signed-in provider row, once (README.md "guided-onboarding-fixture.ts"). */
function copyProviderRow({
  provider,
  organizationId,
}: {
  provider: string;
  organizationId: string;
}): void {
  const psql = (sql: string): string =>
    execFileSync("psql", [PG_URL, "-t", "-A", "-c", sql], {
      encoding: "utf8",
      timeout: 60_000,
    }).trim();

  const already = psql(
    `select id from langwatch_db."ModelProvider"
     where provider = '${provider}' and "organizationId" = '${organizationId}' limit 1`,
  );
  if (already) return;

  const source = psql(
    `select id from langwatch_db."ModelProvider"
     where provider = '${provider}' and enabled
     order by "createdAt" desc limit 1`,
  );
  if (!source) {
    throw new Error(
      `no enabled ${provider} row in this database; sign it in once on any organization first`,
    );
  }

  const suffix = Math.random().toString(36).slice(2, 10);
  psql(
    `insert into langwatch_db."ModelProvider"
       (id, provider, enabled, "customKeys", "deploymentMapping", "customModels",
        "customEmbeddingsModels", "extraHeaders", name, "providerConfig",
        "organizationId", "createdAt", "updatedAt")
     select 'provider_copy_${suffix}', provider, true, "customKeys",
            "deploymentMapping", "customModels", "customEmbeddingsModels",
            "extraHeaders", name, "providerConfig", '${organizationId}',
            now(), now()
     from langwatch_db."ModelProvider" where id = '${source}'`,
  );
  psql(
    `insert into langwatch_db."ModelProviderScope"
       (id, "modelProviderId", "scopeType", "scopeId", "createdAt")
     values ('mpscope_copy_${suffix}', 'provider_copy_${suffix}',
             'ORGANIZATION', '${organizationId}', now())`,
  );
  console.log(`[seed-provider] copied a ${provider} row into ${organizationId}`);
}
