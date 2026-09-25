import type { DlpServiceClient } from "@google-cloud/dlp";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { GoogleDlpChannel, GoogleDlpFinding } from "../google-dlp.channel.ts";

const logger = createLogger("langwatch:data-privacy:google-dlp");

/**
 * Narrowed to the one required field, loose on purpose: the whole document goes
 * to the SDK, and dropping the key while keeping `project_id` would build a
 * client that authenticates with nothing.
 */
const googleDlpCredentialsSchema = z.looseObject({ project_id: z.string().trim().min(1) });

type GoogleDlpCredentials = z.infer<typeof googleDlpCredentialsSchema>;

/** Invalid JSON degrades DLP to unavailable rather than failing an unrelated boot, as on main. */
function parseCredentials(credential: string | undefined): GoogleDlpCredentials | undefined {
  if (!credential) return undefined;
  let document: unknown;
  try {
    document = JSON.parse(credential);
  } catch (error) {
    logger.warn({ error }, "GOOGLE_APPLICATION_CREDENTIALS is not valid JSON; Google DLP is off");
    return undefined;
  }
  const parsed = googleDlpCredentialsSchema.safeParse(document);
  if (!parsed.success) {
    logger.warn(
      { error: parsed.error },
      "GOOGLE_APPLICATION_CREDENTIALS names no project_id; Google DLP is off",
    );
    return undefined;
  }
  return parsed.data;
}

/** Loads the SDK on first inspection only; see specs/setup/memory-footprint.feature. */
async function openClient(credentials: GoogleDlpCredentials): Promise<DlpServiceClient> {
  const { DlpServiceClient } = await import("@google-cloud/dlp");
  return new DlpServiceClient({ credentials });
}

/** A port of main's `WorkerPiiAnalysisAdapter` DLP half; the client opens on first inspection. */
export class HttpGoogleDlpChannel implements GoogleDlpChannel {
  static create(input: { credential: string | undefined }): HttpGoogleDlpChannel {
    return new HttpGoogleDlpChannel(parseCredentials(input.credential));
  }

  #client: Promise<DlpServiceClient> | undefined;

  private constructor(private readonly credentials: GoogleDlpCredentials | undefined) {}

  async inspect(input: {
    text: string;
    infoTypes: readonly string[];
  }): Promise<GoogleDlpFinding[]> {
    const credentials = this.credentials;
    if (!credentials) {
      throw new Error(
        "Google DLP redaction requested but GOOGLE_APPLICATION_CREDENTIALS is not configured. Configure the credentials or lower the data-privacy PII level for this scope.",
      );
    }
    const client = await this.#open(credentials);
    const [response] = await client.inspectContent({
      parent: `projects/${credentials.project_id}/locations/global`,
      inspectConfig: {
        infoTypes: input.infoTypes.map((name) => ({ name })),
        minLikelihood: "POSSIBLE",
        limits: { maxFindingsPerRequest: 0 },
        includeQuote: true,
      },
      item: { value: input.text },
    });

    return (response.result?.findings ?? []).flatMap((finding) => {
      const start = finding.location?.codepointRange?.start;
      const end = finding.location?.codepointRange?.end;
      if (start == null || end == null) return [];
      return [{ start: Number(start), end: Number(end), quote: finding.quote ?? undefined }];
    });
  }

  #open(credentials: GoogleDlpCredentials): Promise<DlpServiceClient> {
    this.#client ??= openClient(credentials).catch((error: unknown) => {
      this.#client = undefined;
      throw error;
    });
    return this.#client;
  }

  async close(): Promise<void> {
    const client = await this.#client?.catch(() => undefined);
    await client?.close();
  }
}
