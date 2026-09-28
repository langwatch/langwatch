import { createLogger } from "@langwatch/observability";
import { type GenericOAuthConfig, genericOAuth } from "better-auth/plugins/generic-oauth";

const logger = createLogger("langwatch:better-auth:generic-oauth");

type GenericOAuthPlugin = ReturnType<typeof genericOAuth>;
type AuthContext = Parameters<GenericOAuthPlugin["init"]>[0];
type GenericProvider = Awaited<
  ReturnType<GenericOAuthPlugin["init"]>
>["context"]["socialProviders"][number];

/** Waits between attempts to mount a provider that failed at startup. */
export const DEFAULT_RETRY_DELAYS_MS = [5_000, 10_000, 30_000, 60_000, 120_000, 300_000] as const;

/**
 * better-auth's genericOAuth plugin, with a provider that cannot initialize left out and retried in
 * the background instead of failing the auth context and the process. Each provider is initialized
 * by the real plugin alone, with the same ID-token verification (mfa-and-session-shape.feature).
 */
export function resilientGenericOAuth({
  config,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: {
  config: GenericOAuthConfig[];
  retryDelaysMs?: readonly number[];
}): GenericOAuthPlugin {
  const plugin = genericOAuth({ config });

  return {
    ...plugin,
    init: async (ctx) => {
      const mounted: GenericProvider[] = [];
      const pending: GenericOAuthConfig[] = [];

      for (const providerConfig of config) {
        const result = await initProvider({ ctx, providerConfig });
        if (result.ok) {
          mounted.push(result.provider);
          continue;
        }
        const host = discoveryHostOf(providerConfig);
        logger.error(
          { providerId: providerConfig.providerId, discoveryHost: host, reason: result.reason },
          `Identity provider "${providerConfig.providerId}" could not be initialized from ${host}; its sign-in is unavailable and will be retried in the background`,
        );
        pending.push(providerConfig);
      }

      // better-auth keeps this exact array and every request reads it, so a later mount is served.
      const socialProviders = [...mounted, ...ctx.socialProviders];
      for (const providerConfig of pending) {
        retryUntilMounted({ ctx, providerConfig, socialProviders, retryDelaysMs });
      }

      return { context: { socialProviders } };
    },
  };
}

type InitResult = { ok: true; provider: GenericProvider } | { ok: false; reason: string[] };

/** Runs the real plugin's init for one provider, collecting its error lines into the result. */
async function initProvider({
  ctx,
  providerConfig,
}: {
  ctx: AuthContext;
  providerConfig: GenericOAuthConfig;
}): Promise<InitResult> {
  const captured: string[] = [];
  let capturing = true;
  const parentLogger = ctx.logger;
  const scopedLogger: AuthContext["logger"] = {
    ...parentLogger,
    error: (message, ...args) => {
      if (capturing) captured.push(String(message));
      else parentLogger.error(message, ...args);
    },
  };
  // The provider keeps this context for its lifetime, so it inherits the rest from the real one.
  const scopedCtx: AuthContext = Object.create(ctx, {
    logger: { value: scopedLogger, enumerable: true },
  });

  try {
    const result = await genericOAuth({ config: [providerConfig] }).init(scopedCtx);
    const provider = result.context.socialProviders.find(
      (candidate) =>
        candidate.id === providerConfig.providerId && !ctx.socialProviders.includes(candidate),
    );
    if (!provider) return { ok: false, reason: captured };
    for (const line of captured) parentLogger.error(line);
    return { ok: true, provider };
  } catch (error) {
    return {
      ok: false,
      reason: [...captured, error instanceof Error ? error.message : String(error)],
    };
  } finally {
    capturing = false;
  }
}

function retryUntilMounted({
  ctx,
  providerConfig,
  socialProviders,
  retryDelaysMs,
}: {
  ctx: AuthContext;
  providerConfig: GenericOAuthConfig;
  socialProviders: GenericProvider[];
  retryDelaysMs: readonly number[];
}): void {
  if (retryDelaysMs.length === 0) return;

  const attempt = async (attemptIndex: number): Promise<void> => {
    const result = await initProvider({ ctx, providerConfig });
    if (result.ok) {
      socialProviders.unshift(result.provider);
      logger.info(
        { providerId: providerConfig.providerId, discoveryHost: discoveryHostOf(providerConfig) },
        `Identity provider "${providerConfig.providerId}" initialized; its sign-in is available`,
      );
      return;
    }
    logger.debug(
      { providerId: providerConfig.providerId, reason: result.reason },
      "identity provider still unavailable, retrying",
    );
    schedule(attemptIndex + 1);
  };

  const schedule = (attemptIndex: number) => {
    const delay = retryDelaysMs[Math.min(attemptIndex, retryDelaysMs.length - 1)] ?? 0;
    setTimeout(() => {
      attempt(attemptIndex).catch((error: unknown) => {
        logger.error(
          { error, providerId: providerConfig.providerId },
          "retrying identity provider initialization failed",
        );
        schedule(attemptIndex + 1);
      });
    }, delay).unref();
  };

  schedule(0);
}

/** Where the provider's discovery document lives, for the log line; its configuration otherwise. */
function discoveryHostOf(providerConfig: GenericOAuthConfig): string {
  const fallback = "its configuration";
  if (!providerConfig.discoveryUrl) return fallback;
  try {
    return new URL(providerConfig.discoveryUrl).host;
  } catch {
    return fallback;
  }
}
