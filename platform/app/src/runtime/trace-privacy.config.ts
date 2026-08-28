import { z } from "zod";

const environmentSchema = z.object({
  googleApplicationCredentials: z.string().optional(),
  googleDlpDisabled: z.union([z.boolean(), z.string()]).optional(),
  langevalsEndpoint: z.string().optional(),
  nodeEnv: z.string().optional(),
  dataPrivacyEnforcement: z.string().optional(),
  tiktokensPath: z.string().optional(),
  tiktokenFetchTimeoutMs: z.union([z.string(), z.number()]).optional(),
});

const googleDlpCredentialsSchema = z.object({ project_id: z.string().trim().min(1) }).passthrough();

export type GoogleDlpCredentials = z.infer<typeof googleDlpCredentialsSchema>;

export type GoogleDlpCredentialsFailure =
  | Readonly<{ reason: "invalid-json"; error: unknown }>
  | Readonly<{ reason: "missing-project-id"; error: z.ZodError }>;

export type TracePrivacyRuntimeConfig = Readonly<{
  googleDlp: Readonly<{
    disabled: boolean;
    credentials: GoogleDlpCredentials | undefined;
  }>;
  presidio: Readonly<{ endpoint: string | undefined; timeoutMs: number }>;
  isProduction: boolean;
  nativePolicyEnforced: boolean;
  tokenizer: Readonly<{
    bpeDirectory: string | undefined;
    fetchTimeoutMs: number;
  }>;
}>;

const DEFAULT_PRESIDIO_TIMEOUT_MS = 60_000;
const DEFAULT_TIKTOKEN_FETCH_TIMEOUT_MS = 10_000;

function positiveTimeout(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Projects the private Trace privacy settings once at process boot. Invalid
 * service-account JSON deliberately preserves the old unavailable-DLP
 * behaviour rather than making unrelated application boot fail.
 */
export function resolveTracePrivacyRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
  onInvalidCredentials: (failure: GoogleDlpCredentialsFailure) => void = () => undefined,
): TracePrivacyRuntimeConfig {
  const environment = environmentSchema.parse(source);
  let credentials: GoogleDlpCredentials | undefined;

  if (environment.googleApplicationCredentials) {
    try {
      const parsedCredentials = JSON.parse(environment.googleApplicationCredentials);
      const validatedCredentials = googleDlpCredentialsSchema.safeParse(parsedCredentials);
      if (validatedCredentials.success) {
        credentials = validatedCredentials.data;
      } else {
        onInvalidCredentials({ reason: "missing-project-id", error: validatedCredentials.error });
      }
    } catch (error) {
      onInvalidCredentials({ reason: "invalid-json", error });
    }
  }

  return {
    googleDlp: {
      disabled: environment.googleDlpDisabled === true || environment.googleDlpDisabled === "true",
      credentials,
    },
    presidio: { endpoint: environment.langevalsEndpoint, timeoutMs: DEFAULT_PRESIDIO_TIMEOUT_MS },
    isProduction: environment.nodeEnv === "production",
    nativePolicyEnforced: environment.dataPrivacyEnforcement !== "off",
    tokenizer: {
      bpeDirectory: environment.tiktokensPath,
      fetchTimeoutMs: positiveTimeout(
        environment.tiktokenFetchTimeoutMs,
        DEFAULT_TIKTOKEN_FETCH_TIMEOUT_MS,
      ),
    },
  };
}
