import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STRIPE_METER_NAMES,
  STRIPE_PRICE_NAMES,
  stripePricesFileSchema,
  type StripeEnvironment,
  type StripeMeterMap,
  type StripePriceDetail,
  type StripePriceMap,
  type StripePriceName,
  type StripePricesFile,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import Stripe from "stripe";

const logger = createLogger("langwatch:task:stripe-prices-sync");

const DEFAULT_OUTPUT_PATH = fileURLToPath(
  new URL("../../../contract/src/stripe-catalog.json", import.meta.url),
);

const PAGE_LIMIT = 100;
const PAGE_DELAY_MS = 250;
const RETRY_ATTEMPTS = 4;
const RETRY_BACKOFF_BASE_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sortRecordByKey = <T>(record: Record<string, T>): Record<string, T> => {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
};

export const createEmptyCatalog = (): StripePricesFile => {
  const mapping = {} as StripePricesFile["mapping"];
  for (const key of STRIPE_PRICE_NAMES) {
    mapping[key] = { test: "", live: "" };
  }

  const meters = {} as StripePricesFile["meters"];
  for (const key of STRIPE_METER_NAMES) {
    meters[key] = { test: "", live: "" };
  }

  return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), mapping, meters, prices: {} };
};

export const backfillCatalogDefaults = (raw: Record<string, unknown>): Record<string, unknown> => {
  if (!raw.meters || typeof raw.meters !== "object") {
    const meters = {} as StripePricesFile["meters"];
    for (const key of STRIPE_METER_NAMES) {
      meters[key] = { test: "", live: "" };
    }
    return { ...raw, meters };
  }
  return raw;
};

const readCatalog = (outputPath: string): StripePricesFile | null => {
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(outputPath, "utf8")) as Record<string, unknown>;
  const backfilled = backfillCatalogDefaults(raw);
  const result = stripePricesFileSchema.safeParse(backfilled);

  if (!result.success) {
    logger.warn(
      { errors: result.error.issues.length, outputPath },
      "Existing catalog failed validation, rebuilding from scratch",
    );
    return null;
  }

  return result.data;
};

const writeCatalog = (outputPath: string, data: StripePricesFile): void => {
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
};

export const detectEnvironment = (secretKey: string): StripeEnvironment => {
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) {
    return "test";
  }
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return "live";
  }
  throw new Error("STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_, or rk_live_");
};

const isRetryableStripeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const maybeStripeError = error as Stripe.errors.StripeError & { statusCode?: number };
  const statusCode = maybeStripeError.statusCode;
  return (
    maybeStripeError.type === "StripeRateLimitError" ||
    statusCode === 429 ||
    (typeof statusCode === "number" && statusCode >= 500)
  );
};

const withRetry = async <T>(action: () => Promise<T>, description: string): Promise<T> => {
  let attempt = 1;
  while (true) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= RETRY_ATTEMPTS || !isRetryableStripeError(error)) {
        throw error;
      }
      const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1);
      logger.warn(
        {
          attempt,
          backoffMs,
          description,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retrying Stripe request",
      );
      await sleep(backoffMs);
      attempt += 1;
    }
  }
};

export const fetchAllStripePrices = async (stripe: Stripe): Promise<Stripe.Price[]> => {
  const allPrices: Stripe.Price[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const response = await withRetry(
      async () =>
        await stripe.prices.list({
          limit: PAGE_LIMIT,
          starting_after: startingAfter,
          expand: ["data.product"],
        }),
      "stripe.prices.list",
    );
    allPrices.push(...response.data);
    if (!response.has_more || response.data.length === 0) {
      break;
    }
    startingAfter = response.data[response.data.length - 1]?.id;
    await sleep(PAGE_DELAY_MS);
  }

  return allPrices;
};

export const fetchAllStripeMeters = async (stripe: Stripe): Promise<Stripe.Billing.Meter[]> => {
  const allMeters: Stripe.Billing.Meter[] = [];
  let startingAfter: string | undefined;

  while (true) {
    const response = await withRetry(
      async () =>
        await stripe.billing.meters.list({ limit: PAGE_LIMIT, starting_after: startingAfter }),
      "stripe.billing.meters.list",
    );
    allMeters.push(...response.data);
    if (!response.has_more || response.data.length === 0) {
      break;
    }
    startingAfter = response.data[response.data.length - 1]?.id;
    await sleep(PAGE_DELAY_MS);
  }

  return allMeters;
};

export const transformPrice = (price: Stripe.Price): StripePriceDetail => {
  const productId = typeof price.product === "string" ? price.product : (price.product?.id ?? null);

  return {
    id: price.id,
    active: price.active,
    livemode: price.livemode,
    product: productId,
    unitAmount: price.unit_amount,
    currency: price.currency,
    type: price.type,
    recurring: price.recurring
      ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count }
      : null,
    nickname: price.nickname,
    lookupKey: price.lookup_key,
    metadata: price.metadata,
  };
};

const chooseLookupMappedPriceId = (
  fetchedPrices: StripePriceDetail[],
  key: StripePriceName,
): string | undefined => {
  const matches = fetchedPrices.filter(
    (price) =>
      price.lookupKey === key ||
      price.metadata.langwatch_key === key ||
      price.metadata.langwatchKey === key,
  );
  if (matches.length === 0) {
    return undefined;
  }
  const activeMatches = matches.filter((price) => price.active);
  const candidates = activeMatches.length > 0 ? activeMatches : matches;
  candidates.sort((left, right) => left.id.localeCompare(right.id));
  return candidates[0]?.id;
};

const resolveRequiredMappings = (params: {
  environment: StripeEnvironment;
  fetchedPricesById: Record<string, StripePriceDetail>;
}): { mapping: StripePriceMap; errors: string[]; warnings: string[] } => {
  const { environment, fetchedPricesById } = params;
  const resolved = {} as StripePriceMap;
  const errors: string[] = [];
  const warnings: string[] = [];
  const fetchedPrices = Object.values(fetchedPricesById);

  for (const key of STRIPE_PRICE_NAMES) {
    const lookupMappedId = chooseLookupMappedPriceId(fetchedPrices, key);
    const selectedDetail = lookupMappedId ? fetchedPricesById[lookupMappedId] : undefined;

    if (!lookupMappedId || !selectedDetail) {
      errors.push(`Missing required lookup_key mapping for ${key} in ${environment} mode`);
      continue;
    }

    resolved[key] = lookupMappedId;
    if (!selectedDetail.active) {
      warnings.push(
        `Mapped key ${key} points to inactive price ${lookupMappedId} in ${environment} mode`,
      );
    }
  }

  return { mapping: resolved, errors, warnings };
};

const METER_EVENT_NAME_PREFIX = "langwatch_";

export const normalizeMeterEventName = (eventName: string): string => {
  const lower = eventName.toLowerCase();
  const stripped = lower.startsWith(METER_EVENT_NAME_PREFIX)
    ? lower.slice(METER_EVENT_NAME_PREFIX.length)
    : lower;
  return stripped.toUpperCase();
};

export const resolveRequiredMeterMappings = (params: {
  environment: StripeEnvironment;
  fetchedMeters: Stripe.Billing.Meter[];
}): { mapping: StripeMeterMap; errors: string[]; warnings: string[] } => {
  const { environment, fetchedMeters } = params;
  const resolved = {} as StripeMeterMap;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const key of STRIPE_METER_NAMES) {
    const matches = fetchedMeters.filter(
      (meter) => normalizeMeterEventName(meter.event_name) === key,
    );
    if (matches.length === 0) {
      errors.push(`Missing required meter mapping for ${key} in ${environment} mode`);
      continue;
    }

    const activeMatches = matches.filter((meter) => meter.status === "active");
    const candidates = activeMatches.length > 0 ? activeMatches : matches;
    candidates.sort((left, right) => left.id.localeCompare(right.id));

    const selected = candidates[0]!;
    resolved[key] = selected.id;
    if (selected.status !== "active") {
      warnings.push(
        `Mapped meter ${key} points to inactive meter ${selected.id} in ${environment} mode`,
      );
    }
  }

  return { mapping: resolved, errors, warnings };
};

export const validateMappings = (
  file: StripePricesFile,
  environment: StripeEnvironment,
): string[] => {
  const errors: string[] = [];
  const expectedLiveMode = environment === "live";

  for (const key of STRIPE_PRICE_NAMES) {
    const priceId = file.mapping[key][environment];
    if (!priceId) {
      errors.push(`mapping.${key}.${environment} is missing`);
      continue;
    }

    const priceDetails = file.prices[priceId];
    if (!priceDetails) {
      errors.push(`mapping.${key}.${environment} references missing price ${priceId}`);
      continue;
    }

    if (priceDetails.livemode !== expectedLiveMode) {
      errors.push(
        `mapping.${key}.${environment} references ${priceId} with livemode=${priceDetails.livemode}`,
      );
    }
  }

  return errors;
};

export const mergeWithExisting = (params: {
  existing: StripePricesFile;
  environment: StripeEnvironment;
  fetchedPricesById: Record<string, StripePriceDetail>;
  resolvedMapping: StripePriceMap;
  resolvedMeterMapping: StripeMeterMap;
}): StripePricesFile => {
  const { existing, environment, fetchedPricesById, resolvedMapping, resolvedMeterMapping } =
    params;
  const expectedLiveMode = environment === "live";

  const mergedMapping = {} as StripePricesFile["mapping"];
  for (const key of STRIPE_PRICE_NAMES) {
    mergedMapping[key] = {
      test: existing.mapping[key].test,
      live: existing.mapping[key].live,
      [environment]: resolvedMapping[key],
    };
  }

  const mergedMeters = {} as StripePricesFile["meters"];
  for (const key of STRIPE_METER_NAMES) {
    const existingMeter = existing.meters?.[key];
    mergedMeters[key] = {
      test: existingMeter?.test ?? "",
      live: existingMeter?.live ?? "",
      [environment]: resolvedMeterMapping[key],
    };
  }

  const oppositeModePrices = Object.fromEntries(
    Object.entries(existing.prices).filter(([, price]) => price.livemode !== expectedLiveMode),
  );

  const mergedPrices = sortRecordByKey({ ...oppositeModePrices, ...fetchedPricesById });

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    mapping: mergedMapping,
    meters: mergedMeters,
    prices: mergedPrices,
  };
};

export type SyncStripePricesResult = {
  environment: StripeEnvironment;
  priceCount: number;
  meterCount: number;
  outputPath: string;
  warnings: string[];
};

/**
 * Pulls every price and meter this Stripe account has, resolves them onto
 * the fixed `STRIPE_PRICE_NAMES` / `STRIPE_METER_NAMES` keys by `lookup_key`
 * (or `langwatch_key` metadata for prices), and merges the result into the
 * on-disk catalog — the opposite environment's rows are kept untouched, so a
 * test-mode run never erases the live mapping and vice versa.
 */
export const syncStripePrices = async (params: {
  secretKey: string;
  outputPath?: string;
}): Promise<SyncStripePricesResult> => {
  const outputPath = params.outputPath ?? DEFAULT_OUTPUT_PATH;
  const environment = detectEnvironment(params.secretKey);
  const stripe = new Stripe(params.secretKey, { apiVersion: "2024-04-10" });

  logger.info({ environment }, "Fetching Stripe prices and meters");
  const [fetchedPrices, fetchedMeters] = await Promise.all([
    fetchAllStripePrices(stripe),
    fetchAllStripeMeters(stripe),
  ]);
  logger.info(
    { environment, priceCount: fetchedPrices.length, meterCount: fetchedMeters.length },
    "Fetched Stripe prices and meters",
  );

  if (fetchedPrices.length === 0) {
    throw new Error(`Stripe returned no prices for ${environment} mode`);
  }

  const fetchedPricesById = sortRecordByKey(
    Object.fromEntries(fetchedPrices.map((price) => [price.id, transformPrice(price)])),
  );

  const existingCatalog = readCatalog(outputPath) ?? createEmptyCatalog();
  const mappingResolution = resolveRequiredMappings({ environment, fetchedPricesById });
  const meterResolution = resolveRequiredMeterMappings({ environment, fetchedMeters });

  const allErrors = [...mappingResolution.errors, ...meterResolution.errors];
  if (allErrors.length > 0) {
    throw new Error(allErrors.join("\n"));
  }

  const allWarnings = [...mappingResolution.warnings, ...meterResolution.warnings];
  const mergedCatalog = mergeWithExisting({
    existing: existingCatalog,
    environment,
    fetchedPricesById,
    resolvedMapping: mappingResolution.mapping,
    resolvedMeterMapping: meterResolution.mapping,
  });

  const validationErrors = validateMappings(mergedCatalog, environment);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("\n"));
  }

  writeCatalog(outputPath, mergedCatalog);

  if (allWarnings.length > 0) {
    logger.warn(
      { warningCount: allWarnings.length, warnings: allWarnings },
      "Synced Stripe prices with warnings",
    );
  }

  logger.info(
    {
      environment,
      outputPath,
      mappedKeys: STRIPE_PRICE_NAMES.length,
      mappedMeters: STRIPE_METER_NAMES.length,
      priceCount: fetchedPrices.length,
      meterCount: fetchedMeters.length,
    },
    "Stripe prices and meters synced",
  );

  return {
    environment,
    priceCount: fetchedPrices.length,
    meterCount: fetchedMeters.length,
    outputPath,
    warnings: allWarnings,
  };
};

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * stripe-prices-sync`. Regenerates `stripe-catalog.json` in
 * `@langwatch/enterprise-billing-contract` from the deployment's Stripe
 * account, keyed by `STRIPE_SECRET_KEY`.
 */
export class StripePricesSyncTask extends Task {
  readonly name = "stripe-prices-sync";
  readonly description =
    "Regenerates stripe-catalog.json from this Stripe account's prices and meters.";

  private constructor(private readonly secretKey: () => string | undefined) {
    super();
  }

  static create({ secretKey }: { secretKey: () => string | undefined }): StripePricesSyncTask {
    return new StripePricesSyncTask(secretKey);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const secretKey = this.secretKey();
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required to sync Stripe prices");
    }
    await syncStripePrices({ secretKey });
  }
}
