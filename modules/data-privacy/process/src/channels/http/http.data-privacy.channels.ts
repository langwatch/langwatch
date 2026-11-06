import { LambdaClient } from "@aws-sdk/client-lambda";
import type { DataPrivacyServerConfig } from "@langwatch/data-privacy-contract";
import { createLogger } from "@langwatch/observability";
import type { ScopedSecrets } from "@langwatch/secrets";

import { piiRedactionModelTargetOf } from "../../rules/pii-redaction-model.rules.ts";
import { AwsPiiRedactionModelChannel } from "../aws.pii-redaction-model.channel.ts";
import type { DataPrivacyChannels } from "../data-privacy.channels.ts";
import { googleApplicationCredentials } from "../google-dlp.channel.ts";
import type { PresidioChannel } from "../presidio.channel.ts";
import { HttpGoogleDlpChannel } from "./http.google-dlp.channel.ts";
import { HttpPresidioChannel } from "./http.presidio.channel.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-model");

/** PII detection goes to the langevals Presidio endpoint, the redaction model and Google DLP. */
export class HttpDataPrivacyChannels {
  static readonly requires = [] as const;

  static async create({
    config,
    secrets,
  }: {
    config: DataPrivacyServerConfig;
    secrets: ScopedSecrets;
  }): Promise<DataPrivacyChannels> {
    const dlp = await secrets.into(googleApplicationCredentials, (credential) =>
      HttpGoogleDlpChannel.create({ credential }),
    );
    return {
      presidio: HttpPresidioChannel.create({ endpoint: config.langevalsEndpoint }),
      piiRedactionModel: piiRedactionModelChannel({ config }),
      dlp,
    };
  }
}

/** An unusable setting is logged and leaves the model unconfigured: batches stay on Presidio. */
function piiRedactionModelChannel({
  config,
}: {
  config: DataPrivacyServerConfig;
}): PresidioChannel {
  const target = piiRedactionModelTargetOf({
    lambdaArn: config.piiRedactionModelLambdaArn,
    endpoint: config.piiRedactionModelEndpoint,
  });

  if (target.kind === "lambda") {
    // The pod's own role (IRSA) signs the invoke, through the SDK's default credential chain.
    const lambda = new LambdaClient({ region: target.region, maxAttempts: 1 });
    return AwsPiiRedactionModelChannel.create({ lambda, functionArn: target.functionArn });
  }

  if (target.kind === "invalid") {
    logger.error(
      { reason: target.reason },
      "PII redaction model setting is unusable; using Presidio",
    );
  }

  return HttpPresidioChannel.create({
    endpoint: target.kind === "http" ? target.endpoint : void 0,
  });
}
