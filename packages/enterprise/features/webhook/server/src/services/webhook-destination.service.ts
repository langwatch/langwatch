import type {
  SqsCredentialMode,
  WebhookDestinationKind,
} from "@langwatch/enterprise-webhook-contract";

export type WebhookUrlProblemCode =
  | "invalid_url"
  | "scheme"
  | "host"
  | "port"
  | "credentials";

export type ParsedSqsQueueUrl = {
  queueUrl: string;
  region: string;
  accountId: string;
  queueName: string;
};

export type WebhookDestinationConfig =
  | { kind: "http"; url: string }
  | {
      kind: "sqs";
      queueUrl: string;
      roleArn: string | null;
      externalId: string | null;
      accessKeyId: string | null;
      secretAccessKey: string | null;
    };

const SQS_QUEUE_URL_PATTERNS: readonly RegExp[] = [
  /^https:\/\/sqs(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/(\d{12})\/([A-Za-z0-9_-]{1,80}(\.fifo)?)$/,
  /^https:\/\/([a-z0-9-]+)\.queue\.amazonaws\.com(?:\.cn)?\/(\d{12})\/([A-Za-z0-9_-]{1,80}(\.fifo)?)$/,
];

export class WebhookDestinationService {
  private constructor() {}

  static create(): WebhookDestinationService {
    return new WebhookDestinationService();
  }

  tryInspectUrl(url: string, allowInsecureLocal: boolean): WebhookUrlProblemCode | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return "invalid_url";
    }
    if (parsed.username || parsed.password) return "credentials";
    if (!parsed.hostname) return "host";
    if (!allowInsecureLocal && parsed.protocol !== "https:") return "scheme";
    if (!allowInsecureLocal && parsed.port && parsed.port !== "443") return "port";
    return null;
  }

  inspectSqsQueueUrl(
    queueUrl: string,
  ): { ok: true; parsed: ParsedSqsQueueUrl } | { ok: false; problem: "shape" | "fifo" } {
    const trimmed = queueUrl.trim();
    const match = SQS_QUEUE_URL_PATTERNS.reduce<RegExpExecArray | null>(
      (found, pattern) => found ?? pattern.exec(trimmed),
      null,
    );
    if (!match) return { ok: false, problem: "shape" };
    const [, region, accountId, queueName, fifoSuffix] = match;
    if (fifoSuffix) return { ok: false, problem: "fifo" };
    return {
      ok: true,
      parsed: {
        queueUrl: trimmed,
        region: region!,
        accountId: accountId!,
        queueName: queueName!,
      },
    };
  }

  tryParseSqsQueueUrl(queueUrl: string): ParsedSqsQueueUrl | null {
    const result = this.inspectSqsQueueUrl(queueUrl);
    return result.ok ? result.parsed : null;
  }

  isRoleArn(value: string): boolean {
    return /^arn:aws(?:-cn|-us-gov)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/.test(
      value.trim(),
    );
  }

  sqsCredentialMode(input: {
    roleArn: string | null | undefined;
    accessKeyId: string | null | undefined;
  }): SqsCredentialMode {
    if (input.roleArn) return "assume_role";
    if (input.accessKeyId) return "static";
    return "ambient";
  }

  describe(input: {
    destinationKind: WebhookDestinationKind;
    url: string | null;
    sqsQueueUrl: string | null;
  }): string {
    return input.destinationKind === "sqs"
      ? (input.sqsQueueUrl ?? "an Amazon SQS queue")
      : (input.url ?? "an HTTPS endpoint");
  }
}
