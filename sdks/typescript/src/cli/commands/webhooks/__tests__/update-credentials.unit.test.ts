import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/client-sdk/services/webhooks/webhooks-api.service", () => ({
  WebhooksApiService: vi.fn(),
}));

vi.mock("../../../utils/apiKey", () => ({
  checkOrgApiKey: () => "sk-lw-test",
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

import { WebhooksApiService } from "@/client-sdk/services/webhooks/webhooks-api.service";
import { updateWebhookCommand } from "../update";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // Keeps the command's own output out of the test report.
};

const ENDPOINT = {
  id: "wh_1",
  destination_kind: "sqs",
  url: null,
  sqs: { queue_url: "https://sqs.eu-central-1.amazonaws.com/381491922238/q" },
  enabled_events: ["gateway.request.completed"],
  max_batch_size: 50,
  max_batch_delay_ms: 1000,
  max_in_flight: 4,
};

describe("Feature: a queue endpoint's credential mode is switched from the CLI", () => {
  let mockUpdate: ReturnType<typeof vi.fn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate = vi.fn().mockResolvedValue(ENDPOINT);
    vi.mocked(WebhooksApiService).mockImplementation(function () {
      return { update: mockUpdate } as unknown as WebhooksApiService;
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    stderr = vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
    vi.stubEnv("LANGWATCH_SQS_SECRET_ACCESS_KEY", "an-example-secret");
  });

  const sentSqs = (): Record<string, unknown> =>
    (mockUpdate.mock.calls[0]?.[1] as { sqs: Record<string, unknown> }).sqs;

  describe("given the endpoint currently uses a static key pair", () => {
    /**
     * The server resolves a role over a key pair, so a role sent on its own
     * would win while the stored key stayed encrypted at rest, unreadable
     * through every read surface and impossible to rotate.
     */
    it("clears the key pair when the role is set", async () => {
      await updateWebhookCommand("wh_1", {
        roleArn: "arn:aws:iam::381491922238:role/langwatch-producer",
      });

      expect(sentSqs()).toEqual({
        role_arn: "arn:aws:iam::381491922238:role/langwatch-producer",
        access_key_id: null,
        secret_access_key: null,
      });
    });
  });

  describe("given the endpoint currently assumes a role", () => {
    /**
     * The reverse direction is the one that used to change nothing: the stored
     * role outranked the key pair being set, so the switch answered success
     * and the endpoint went on assuming the role.
     */
    it("clears the role and its external id when a key pair is set", async () => {
      await updateWebhookCommand("wh_1", { accessKeyId: "AKIAEXAMPLE" });

      expect(sentSqs()).toEqual({
        access_key_id: "AKIAEXAMPLE",
        secret_access_key: "an-example-secret",
        role_arn: null,
        external_id: null,
      });
    });
  });

  describe("when both credential flags are passed", () => {
    const bothFlags = {
      roleArn: "arn:aws:iam::381491922238:role/langwatch-producer",
      accessKeyId: "AKIAEXAMPLE",
    };

    const saidOnStderr = (phrase: string) =>
      stderr.mock.calls
        .flat()
        .some((line: unknown) => String(line).includes(phrase));

    it("refuses before sending anything, and says why", async () => {
      await expect(
        updateWebhookCommand("wh_1", bothFlags),
      ).rejects.toBeInstanceOf(ProcessExitError);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(saidOnStderr("different credential modes")).toBe(true);
    });

    /**
     * The mode conflict is checked first on purpose. Asking for the missing
     * secret of a key pair the caller cannot use anyway sends them to set a
     * secret and then refuses the command a second time, for the real reason.
     */
    it("names the mode conflict, not the missing secret, when neither is set", async () => {
      vi.stubEnv("LANGWATCH_SQS_SECRET_ACCESS_KEY", "");

      await expect(
        updateWebhookCommand("wh_1", bothFlags),
      ).rejects.toBeInstanceOf(ProcessExitError);

      expect(saidOnStderr("different credential modes")).toBe(true);
      expect(saidOnStderr("LANGWATCH_SQS_SECRET_ACCESS_KEY")).toBe(false);
    });
  });
});
