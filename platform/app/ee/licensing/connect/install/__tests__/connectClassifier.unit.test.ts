/**
 * The classifier a connected install judges with: what it sends, what it
 * refuses to send, and how quickly an admin's decision reaches it.
 *
 * @see ../connectClassifier.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import type { InstantEvalQuestion } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  ConnectInstantEvalClassifier,
  STATE_TTL_MS,
} from "../connectClassifier";
import { readConnectConfig } from "../connectConfig";
import { resetInstanceIdentity } from "../instanceIdentity";
import {
  INSTANCE_ID,
  instanceIdentityTable,
  LANGWATCH_KEYS,
  LICENSE,
  mintLicense,
} from "./installFakes";

const env = vi.hoisted(() => ({}) as Record<string, unknown>);

vi.mock("~/env.mjs", () => ({ env }));

const ORGANIZATION = "organization-of-record";
const PROJECT = "project-of-record";

/**
 * A license naming hosted judging, signed by this suite's key pair. Signed
 * rather than hand-built, because the entitlement the classifier reads comes
 * out of the signature check: an unsigned blob names no service at all.
 */
const LICENSE_KEY = LICENSE.licenseKey;

/** The same license with no hosted service named: an offline customer. */
const OFFLINE_LICENSE_KEY = mintLicense({ connectServices: [] }).licenseKey;

const QUESTION: InstantEvalQuestion = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

const ANSWER = {
  verdicts: [{ questionId: "annoyed", probability: 0.82 }],
  inputTokens: 140,
  isTextTruncated: false,
  chargedUsd: 0.000_01,
};

interface Row {
  connectServicesDisabled: string[];
  license: string | null;
}

function prismaWith(row: Row) {
  return {
    row,
    client: {
      project: {
        findUnique: vi.fn(async () => ({
          team: { organizationId: ORGANIZATION },
        })),
      },
      organization: {
        findUnique: vi.fn(async () => ({
          connectServicesDisabled: row.connectServicesDisabled,
          license: row.license,
        })),
      },
      instanceIdentity: instanceIdentityTable(),
    } as unknown as PrismaClient,
  };
}

function classifierOver({
  row,
  clock,
  classify,
}: {
  row: Row;
  clock: { now: number };
  classify?: ReturnType<typeof vi.fn>;
}) {
  const store = prismaWith(row);
  const call = classify ?? vi.fn(async () => ANSWER);
  const config = readConnectConfig();
  if (!config.permitted) throw new Error("the suite must permit Connect");

  return {
    store,
    call,
    classifier: new ConnectInstantEvalClassifier({
      prisma: store.client,
      config,
      client: { classify: call } as never,
      now: () => clock.now,
    }),
  };
}

function judge(classifier: ConnectInstantEvalClassifier) {
  return classifier.classify({
    projectId: PROJECT,
    text: "the customer wrote in",
    questions: [QUESTION],
  });
}

beforeEach(() => {
  for (const key of Object.keys(env)) delete env[key];
  process.env.LANGWATCH_LICENSE_PUBLIC_KEY = LANGWATCH_KEYS.publicKey;
  resetInstanceIdentity();
});

describe("given an organization whose license names no hosted judging", () => {
  describe("when an eval function runs", () => {
    /** @scenario "An install with the service off publishes eval functions as unavailable" */
    it("skips the judgement and sends nothing", async () => {
      const { classifier, call } = classifierOver({
        row: { connectServicesDisabled: [], license: OFFLINE_LICENSE_KEY },
        clock: { now: 0 },
      });

      await expect(judge(classifier)).resolves.toEqual({
        verdicts: [],
        skippedReason: "classifier_not_configured",
        inputTokens: 0,
        isTextTruncated: false,
      });
      expect(call).not.toHaveBeenCalled();
    });

    it("publishes the eval functions as unavailable for that organization", async () => {
      const { classifier } = classifierOver({
        row: { connectServicesDisabled: [], license: OFFLINE_LICENSE_KEY },
        clock: { now: 0 },
      });

      await expect(
        classifier.isAvailableForOrganization(ORGANIZATION),
      ).resolves.toBe(false);
    });
  });
});

describe("given an organization with no license at all", () => {
  describe("when an eval function runs", () => {
    /** @scenario "An install without a license cannot use Connect" */
    it("skips the judgement and sends nothing", async () => {
      const { classifier, call } = classifierOver({
        row: { connectServicesDisabled: [], license: null },
        clock: { now: 0 },
      });

      await expect(judge(classifier)).resolves.toMatchObject({
        skippedReason: "classifier_not_configured",
      });
      expect(call).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization whose license names hosted judging", () => {
  describe("when an eval function runs", () => {
    /** @scenario "An install with the service on judges through the hosted service" */
    it("judges through the hosted service and returns the usual shape", async () => {
      const { classifier, call } = classifierOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        clock: { now: 0 },
      });

      const judgement = await judge(classifier);

      expect(judgement).toEqual({
        verdicts: [{ questionId: "annoyed", probability: 0.82 }],
        inputTokens: 140,
        isTextTruncated: false,
      });
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          credential: expect.objectContaining({ instanceId: INSTANCE_ID }),
          text: "the customer wrote in",
          questions: [QUESTION],
        }),
      );
    });

    it("carries a skip the host reported back as this side's own reason", async () => {
      const { classifier } = classifierOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        clock: { now: 0 },
        classify: vi.fn(async () => ({
          verdicts: [],
          skippedReason: "classifier_input_too_large",
          inputTokens: 0,
          isTextTruncated: true,
          chargedUsd: 0,
        })),
      });

      await expect(judge(classifier)).resolves.toMatchObject({
        skippedReason: "classifier_input_too_large",
        isTextTruncated: true,
      });
    });

    it("reads the organization once for a run of many judgements", async () => {
      const clock = { now: 0 };
      const { classifier, store } = classifierOver({
        row: { connectServicesDisabled: [], license: LICENSE_KEY },
        clock,
      });

      await judge(classifier);
      await judge(classifier);
      await judge(classifier);

      // Two reads: the entitlement and the switch in one, and the license
      // the credential comes from. Both are held, so three judgements cost
      // the same as one.
      expect(store.client.organization.findUnique).toHaveBeenCalledTimes(2);
    });
  });
});

describe("given an administrator who switches the service back on while the process runs", () => {
  describe("when the next eval function runs", () => {
    /** @scenario "Switching the service on takes effect without a restart" */
    it("judges through the hosted service without a restart", async () => {
      const clock = { now: 0 };
      const row: Row = {
        connectServicesDisabled: ["instant_evals"],
        license: LICENSE_KEY,
      };
      const { classifier, call } = classifierOver({ row, clock });

      await expect(judge(classifier)).resolves.toMatchObject({
        skippedReason: "classifier_not_configured",
      });

      row.connectServicesDisabled = [];
      clock.now += STATE_TTL_MS;

      await expect(judge(classifier)).resolves.toMatchObject({
        verdicts: [{ questionId: "annoyed", probability: 0.82 }],
      });
      expect(call).toHaveBeenCalledTimes(1);
    });
  });
});
