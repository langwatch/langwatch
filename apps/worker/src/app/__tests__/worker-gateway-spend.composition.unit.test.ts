import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { InMemoryWebhookDispatchRateLimiterAdapter, WebhookEgressService } from "@langwatch/egress";
import { resolveWorkerConfig } from "../../platform/config/worker.config";
import {
  createWorkerGatewaySpend,
  dispatchWebhookThrough,
  WorkerGatewaySpendAbsenceReportPort,
} from "../worker-gateway-spend.composition";
import { createWorkerProcessDatabase } from "./support/worker-database.double";

/**
 * Spec: specs/ai-gateway/worker-gateway-spend-conversion.feature
 *
 * THE CONVERSION, asserted where it can actually fail. Both definitions used to
 * arrive from the application; re-registering one could not tell a graph that
 * reaches its own collaborators from one that was handed in. So the assertions
 * below build both real definitions from substrates, drive the debit path's
 * delivery into Governance's own commands, and hold the four absences to being
 * DECLARED rather than silently answered — every one of which is invisible in
 * production if it is not.
 */

const RECORDED: { governance: Array<{ command: string; data: unknown }>; absences: string[] } = {
  governance: [],
  absences: [],
};

function reset(): void {
  RECORDED.governance.length = 0;
  RECORDED.absences.length = 0;
}

class RecordingAbsence extends WorkerGatewaySpendAbsenceReportPort {
  withoutSpendSettlement(): void {
    RECORDED.absences.push("spendSettlement");
  }
  withoutSqsWebhookDestinations(): void {
    RECORDED.absences.push("sqsWebhookDestinations");
  }
  withoutWebhookEntitlements(): void {
    RECORDED.absences.push("webhookEntitlements");
  }
  withoutEndpointSecretKey(): void {
    RECORDED.absences.push("endpointSecretKey");
  }
}

/** One ClickHouse endpoint, answering nothing: enough to build a sweeper over. */
function instance(target: string) {
  return {
    target,
    client: {
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    },
  };
}

function compose(
  source: Record<string, unknown> = {},
  substrates: {
    instances?: Array<ReturnType<typeof instance>>;
    awsClientConfig?: () => never;
  } = {},
) {
  return createWorkerGatewaySpend({
    config: resolveWorkerConfig({ NODE_ENV: "test", ...source }),
    database: createWorkerProcessDatabase() as never,
    resolveClickHouseClient: (async () => ({
      insert: async () => undefined,
      query: async () => ({ json: async () => [] }),
    })) as never,
    ...(substrates.instances
      ? { resolveClickHouseInstances: (async () => substrates.instances) as never }
      : {}),
    ...(substrates.awsClientConfig ? { awsClientConfig: substrates.awsClientConfig as never } : {}),
    redis: null,
    processStore: {} as never,
    egress: WebhookEgressService.create({
      rateLimiter: InMemoryWebhookDispatchRateLimiterAdapter.create(),
      tls: { rejectUnauthorized: true },
    }),
    governanceCommands: {
      recordVkLifecycle: async (data) => {
        RECORDED.governance.push({ command: "recordVkLifecycle", data });
      },
      recordBudgetCrossing: async (data) => {
        RECORDED.governance.push({ command: "recordBudgetCrossing", data });
      },
    },
    absence: new RecordingAbsence(),
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
  });
}

function frozenRoutingKeys(name: string): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as { pipelines: Array<{ name: string; jobs: string[] }> };
  const pipeline = registry.pipelines.find((entry) => entry.name === name);
  if (!pipeline) throw new Error(`${name} is absent from the job registry`);
  return pipeline.jobs;
}

type BuiltDefinition = {
  metadata: { name: string };
  foldProjections: Map<string, unknown>;
  stateProjections?: Map<string, unknown>;
  mapProjections: Map<string, unknown>;
  commands: ReadonlyArray<{ name: string }>;
  foldSubscribers: Map<string, unknown>;
  mapSubscribers: Map<string, unknown>;
  eventSubscribers: Map<string, unknown>;
  processManagers: Map<string, { config: { eventTypes: readonly string[] } }>;
};

function registeredKeys(definition: BuiltDefinition): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.stateProjections?.keys() ?? []) keys.add(`stateProjection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);
  for (const [name, manager] of definition.processManagers) {
    // The runtime's own rule: a schedule-only process manager registers no
    // live subscriber, so it stages no routing key.
    if (manager.config.eventTypes.length > 0) keys.add(`subscriber:pm:${name}`);
  }
  return keys;
}

describe("given the spend spine and the governance signal log this process composes", () => {
  describe("when the composition root builds them", () => {
    /** @scenario "The worker mounts every gateway spend and governance routing key" */
    it("registers every spend routing key the frozen registry lists, and no other", () => {
      reset();
      const definition = compose().spend.buildProcessing() as unknown as BuiltDefinition;
      const registered = registeredKeys(definition);

      const frozen = frozenRoutingKeys("gateway_spend_processing");
      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(7);
    });

    /** @scenario "The worker mounts every gateway spend and governance routing key" */
    it("registers every governance routing key the frozen registry lists, and no other", () => {
      reset();
      const definition = compose().governance.buildProcessing() as unknown as BuiltDefinition;
      const registered = registeredKeys(definition);

      const frozen = frozenRoutingKeys("governance_events_processing");
      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(3);
    });

    /**
     * The settlement sweeper is absent only where the graph cannot enumerate,
     * and this asserts what that costs: NOTHING in routing terms, because it
     * subscribes to no event. A future change that gave it an `.on(...)`
     * handler would start staging a key this graph does not claim, and this is
     * where that shows up.
     *
     * @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("mounts no process manager the registry does not name", () => {
      reset();
      const definition = compose().spend.buildProcessing() as unknown as BuiltDefinition;

      expect([...definition.processManagers.keys()].sort()).toEqual([
        "gatewayDebits",
        "webhookDelivery",
      ]);
    });

    /**
     * The closure of the settlement absence, asserted on the real definition:
     * given the instance directory a graph that opened its own ClickHouse
     * connection holds, the sweeper mounts.
     *
     * @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("mounts the settlement sweeper once it is handed the instance directory", () => {
      reset();
      const definition = compose(
        {},
        { instances: [instance("shared")] },
      ).spend.buildProcessing() as unknown as BuiltDefinition;

      expect([...definition.processManagers.keys()].sort()).toEqual([
        "gatewayDebits",
        "spendSettlement",
        "webhookDelivery",
      ]);
    });

    /**
     * And it still stages no routing key, which is why mounting it does not
     * change what this consumer claims.
     *
     * @scenario "The worker mounts every gateway spend and governance routing key" */
    it("stages no routing key for the sweeper it mounted", () => {
      reset();
      const definition = compose(
        {},
        { instances: [instance("shared")] },
      ).spend.buildProcessing() as unknown as BuiltDefinition;

      const frozen = frozenRoutingKeys("gateway_spend_processing");
      expect([...registeredKeys(definition)].filter((key) => !frozen.includes(key))).toEqual([]);
    });
  });

  describe("when the composition root reports what it could not build", () => {
    /** @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("declares the settlement absence by name at boot", () => {
      reset();
      compose();

      expect(RECORDED.absences).toContain("spendSettlement");
    });

    /** @scenario "The settlement sweeper is declared absent, not silently skipped" */
    it("stops declaring it once the graph can enumerate its ClickHouse endpoints", () => {
      reset();
      compose({}, { instances: [instance("shared")] });

      expect(RECORDED.absences).not.toContain("spendSettlement");
    });

    /**
     * The queue transport is never reported at BOOT — it is reported at the
     * dispatch of an endpoint that named a queue, and only where this graph
     * composed no AWS transport. Both halves matter: a boot-time report would
     * fire on every deployment, including ones with no queue endpoint at all.
     *
     * @scenario "An endpoint that delivers to a queue is refused by name without an AWS transport" */
    it("does not report the queue transport absence at boot", () => {
      reset();
      compose();

      expect(RECORDED.absences).not.toContain("sqsWebhookDestinations");
    });

    /** @scenario "An endpoint secret this deployment encrypted cannot be read without its key" */
    it("declares the missing credentials key rather than signing with plaintext", () => {
      reset();
      compose();

      expect(RECORDED.absences).toContain("endpointSecretKey");
    });

    /** @scenario "An endpoint secret this deployment encrypted cannot be read without its key" */
    it("stops declaring it once the deployment names one", () => {
      reset();
      compose({ CREDENTIALS_SECRET: "a".repeat(64) });

      expect(RECORDED.absences).not.toContain("endpointSecretKey");
    });
  });
});

describe("given a webhook endpoint's last hop", () => {
  /** The batch every case below delivers, so only the destination varies. */
  const batch = {
    organizationId: "organization_1",
    endpointId: "webhook_endpoint_1",
    body: '{"batch":[]}',
    batchId: "batch_1",
    attempt: 1,
    signingSecrets: ["secret_1"],
  };

  function dispatcher(options: { awsClientConfig?: () => never } = {}) {
    const sent: Array<Record<string, unknown>> = [];
    const dispatch = dispatchWebhookThrough(
      {
        config: resolveWorkerConfig({ NODE_ENV: "test" }),
        egress: {
          send: async (input: Record<string, unknown>) => {
            sent.push(input);
            return { status: 200, body: "ok", eventId: input.eventId };
          },
        },
        absence: new RecordingAbsence(),
        ...(options.awsClientConfig ? { awsClientConfig: options.awsClientConfig } : {}),
      } as never,
      { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as never,
    );
    return { dispatch, sent };
  }

  describe("when the endpoint delivers over HTTPS", () => {
    /**
     * The packaged transport, not a twin: this graph used to hand-roll the
     * egress call and re-derive the verdict beside it, so the two could drift
     * about which status codes are worth retrying. The delivery id the log
     * stores is what only the packaged one produces.
     *
     * @scenario "A webhook endpoint delivers through the packaged transport" */
    it("sends through the process's own fenced sender and answers with a delivery id", async () => {
      reset();
      const { dispatch, sent } = dispatcher();

      const result = await dispatch({ ...batch, destination: { kind: "http", url: "https://receiver.test/hook" } } as never);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        url: "https://receiver.test/hook",
        eventId: "batch_1",
        signingSecrets: ["secret_1"],
        projectId: "organization_1",
      });
      expect(result).toMatchObject({ verdict: "success", status: 200, dispatchId: "batch_1" });
    });
  });

  describe("when the endpoint delivers to a queue and no AWS transport was composed", () => {
    /** @scenario "An endpoint that delivers to a queue is refused by name without an AWS transport" */
    it("refuses terminally and names the absence rather than reporting a delivery", async () => {
      reset();
      const { dispatch, sent } = dispatcher();

      const result = await dispatch({
        ...batch,
        destination: {
          kind: "sqs",
          queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
          roleArn: null,
          externalId: null,
          accessKeyId: null,
          secretAccessKey: null,
        },
      } as never);

      expect(result.verdict).toBe("terminal");
      expect(RECORDED.absences).toContain("sqsWebhookDestinations");
      expect(sent).toEqual([]);
    });
  });

  describe("when the endpoint delivers to a queue and this graph owns the AWS transport", () => {
    /**
     * The closure: the queue branch is BUILT rather than refused, so what the
     * delivery reaches is the AWS transport asking this process how to build a
     * client. Before, it never got that far.
     *
     * @scenario "An endpoint that delivers to a queue is refused by name without an AWS transport" */
    it("builds the queue transport and stops naming the absence", async () => {
      reset();
      let asked = 0;
      const { dispatch } = dispatcher({
        awsClientConfig: (() => {
          asked += 1;
          throw new Error("aws client config reached");
        }) as never,
      });

      await expect(
        dispatch({
          ...batch,
          destination: {
            kind: "sqs",
            queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/deliveries",
            roleArn: null,
            externalId: null,
            accessKeyId: null,
            secretAccessKey: null,
          },
        } as never),
      ).rejects.toThrow("aws client config reached");

      expect(asked).toBe(1);
      expect(RECORDED.absences).not.toContain("sqsWebhookDestinations");
    });
  });
});
