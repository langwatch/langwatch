import type { SqsCredentialMode, WebhookDestinationKind } from "@langwatch/webhook-contract";

export type WebhookUrlProblemCode = "invalid_url" | "scheme" | "host" | "port" | "credentials";

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

export function findUrlProblem(
  url: string,
  allowInsecureLocal: boolean,
): WebhookUrlProblemCode | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "invalid_url";
  }

  if (parsed.username || parsed.password) {
    return "credentials";
  }

  if (!parsed.hostname) {
    return "host";
  }

  if (!allowInsecureLocal && parsed.protocol !== "https:") {
    return "scheme";
  }

  if (!allowInsecureLocal && parsed.port && parsed.port !== "443") {
    return "port";
  }

  return null;
}

export function isRoleArn(value: string): boolean {
  return /^arn:aws(?:-cn|-us-gov)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/.test(value.trim());
}

export function sqsCredentialMode(input: {
  roleArn: string | null | undefined;
  accessKeyId: string | null | undefined;
}): SqsCredentialMode {
  if (input.roleArn) {
    return "assume_role";
  }

  if (input.accessKeyId) {
    return "static";
  }

  return "ambient";
}

export function describeDestination(input: {
  destinationKind: WebhookDestinationKind;
  url: string | null;
  sqsQueueUrl: string | null;
}): string {
  return input.destinationKind === "sqs"
    ? (input.sqsQueueUrl ?? "an Amazon SQS queue")
    : (input.url ?? "an HTTPS endpoint");
}
