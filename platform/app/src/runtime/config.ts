import { z } from "zod/v4";

export const appBootConfigSchema = z
  .object({
    nodeEnv: z.enum(["development", "test", "production"]),
    environment: z.string().min(1).default("local"),
    port: z.coerce.number().int().min(1).max(65_535).default(5_560),
    apiPort: z.coerce.number().int().min(1).max(65_535).optional(),
    workersInProcess: z
      .union([
        z.boolean(),
        z.literal("true"),
        z.literal("false"),
        z.literal("1"),
        z.literal("0"),
      ])
      .transform((value) => value === true || value === "true" || value === "1")
      .default(false),
    developmentHttp2: z
      .union([
        z.boolean(),
        z.literal("true"),
        z.literal("false"),
        z.literal("1"),
        z.literal("0"),
      ])
      .transform((value) => value === true || value === "true" || value === "1")
      .default(false),
    developmentHttpsCertificatePath: z.string().min(1).optional(),
    developmentHttpsPrivateKeyPath: z.string().min(1).optional(),
    developmentCertificateDirectory: z.string().min(1).optional(),
    gatewaySecretsConfigured: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (
      Boolean(value.developmentHttpsCertificatePath) !==
      Boolean(value.developmentHttpsPrivateKeyPath)
    ) {
      context.addIssue({
        code: "custom",
        path: ["developmentHttpsCertificatePath"],
        message: "Development HTTPS certificate and private key must be set together.",
      });
    }
  });

export type AppBootConfig = z.infer<typeof appBootConfigSchema>;

export class InvalidAppBootConfigError extends Error {
  readonly name = "InvalidAppBootConfigError";
  readonly issues: ReadonlyArray<{ path: string; code: string }>;

  constructor(error: z.ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    }));
    super(
      `Invalid application boot configuration: ${issues
        .map((issue) => `${issue.path || "<root>"} (${issue.code})`)
        .join(", ")}.`,
    );
    this.issues = issues;
  }
}

/**
 * Resolves only the settings needed by the process boot boundary. It does not
 * read process globals, load dotenv files, create clients, or log at import time.
 */
export class AppBootConfigService {
  resolve(source: Readonly<Record<string, unknown>>): AppBootConfig {
    const result = appBootConfigSchema.safeParse({
      nodeEnv: source.NODE_ENV,
      environment: source.ENVIRONMENT,
      port: source.PORT,
      apiPort: source.LANGWATCH_API_PORT,
      workersInProcess: source.WORKERS_IN_PROCESS,
      developmentHttp2: source.LANGWATCH_DEV_HTTP2,
      developmentHttpsCertificatePath: source.DEV_HTTPS_CERT,
      developmentHttpsPrivateKeyPath: source.DEV_HTTPS_KEY,
      developmentCertificateDirectory: source.LANGWATCH_DEV_CERT_DIR,
      gatewaySecretsConfigured: [
        source.LW_VIRTUAL_KEY_PEPPER,
        source.LW_GATEWAY_INTERNAL_SECRET,
        source.LW_GATEWAY_JWT_SECRET,
      ].every(Boolean),
    });
    if (!result.success) throw new InvalidAppBootConfigError(result.error);
    return result.data;
  }
}
