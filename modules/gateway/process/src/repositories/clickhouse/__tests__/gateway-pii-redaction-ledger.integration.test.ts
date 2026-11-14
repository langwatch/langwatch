/** @vitest-environment node */

/**
 * A priced PII redaction model call, written through gateway's subscriber service and the internal
 * protocol and folded into the spend record: the row billing's meter sums (ADR-201).
 * @see modules/data-privacy/specs/pii-redaction-billing.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import { createTenantId } from "@langwatch/eventing";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { confirmSpendCommandDataSchema } from "../../../eventing/gateway-spend-commands.process.ts";
import { ConfirmSpendCommand } from "../../../eventing/gateway-spend.intent.ts";
import { GatewaySpendStore } from "../../../eventing/gateway-spend.pipeline.ts";
import { GatewaySpendFoldProjection } from "../../../eventing/gateway-spend.projection.ts";
import { GatewayPiiRedactionSpendService } from "../../../features/spend/services/gateway-pii-redaction-spend.service.ts";
import { GatewaySpendEventsService } from "../../../features/spend/services/gateway-spend-events.service.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../../../services/gateway-internal-protocol.service.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";
import { gatewayClickHouseOver } from "./support/clickhouse-endpoint.support.ts";
import { startMigratedGatewayClickHouse } from "./support/migrated-clickhouse.harness.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const PROJECT = `pii-redaction-ledger-${run}`;
const ORGANIZATION = `org-pii-${run}`;
const OCCURRED_AT = Date.UTC(2026, 10, 11, 10, 0, 0);

let client: ClickHouseClient;
let store: GatewaySpendStore;
let protocol: GatewayInternalProtocolService;
let ledger: ClickHouseGatewaySpendEventsRepository;

/** The ledger's own confirm path: the command's event, folded and stored as the pipeline does. */
async function confirmThroughTheSpine(payload: unknown): Promise<void> {
  const data = confirmSpendCommandDataSchema.parse(payload);
  const [event] = await new ConfirmSpendCommand().handle({
    tenantId: createTenantId(data.tenantId),
    data,
  } as Parameters<ConfirmSpendCommand["handle"]>[0]);
  if (!event) throw new Error("the confirm command produced no event");

  const projection = GatewaySpendFoldProjection.create({ store });
  const context = { aggregateId: event.aggregateId, tenantId: event.tenantId };
  const read = await store.get(event.aggregateId, context);
  const state = projection.apply(read.kind === "folded" ? read.state : projection.init(), event);
  await store.store(state, context);
}

/** Only what this suite named; anything else refuses by name. */
function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);

      throw new Error(
        `recordPricedSpend reached "${String(property)}", which this suite did not supply`,
      );
    },
  });
}

function fact({
  requestId,
  priceNanoUsd,
}: {
  requestId: string;
  priceNanoUsd: number;
}): PiiRedactionSpendPricedEventData {
  return {
    tenantId: ORGANIZATION,
    occurredAt: OCCURRED_AT,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    requestId,
    model: "pii-redaction-model",
    rateVersion: "pii_redaction@500nano_per_char",
    characters: priceNanoUsd / 500,
    texts: 3,
    priceNanoUsd,
    costNanoUsd: 93_534,
  };
}

describe.skipIf(!enabled)(
  "the spend record of a PII redaction model call (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ({ client } = await startMigratedGatewayClickHouse());
      ledger = new ClickHouseGatewaySpendEventsRepository(gatewayClickHouseOver(client));
      store = GatewaySpendStore.create(ledger);
      protocol = GatewayInternalProtocolService.create(
        suppliedMembers({
          spend: {
            commands: { confirmSpend: { send: confirmThroughTheSpine } },
            rating: {
              rate: () => {
                throw new Error("a self-priced outcome must not be re-rated");
              },
            },
          },
        }),
      );
    }, 120_000);

    afterAll(async () => {
      if (!client) return;
      await client.command({
        query: "ALTER TABLE gateway_spend DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: PROJECT },
      });
    }, 120_000);

    /** @scenario "The ledger row carries the price as its cost and names the PII redaction model" */
    /** @scenario "The same span redacted twice is one request" */
    it("holds one row per call, however often its fact arrives, and billing's sum reads them", async () => {
      const spend = GatewayPiiRedactionSpendService.create({
        projects: {
          findWithTeam: async (projectId) =>
            projectId === PROJECT
              ? ({
                  id: projectId,
                  team: { id: `team-${run}`, organizationId: ORGANIZATION },
                } as ProjectWithTeam)
              : null,
        },
        recordPricedSpend: (input) => protocol.recordPricedSpend(input),
      });
      const first = fact({ requestId: `piiredaction_a${run}`, priceNanoUsd: 600_000_000 });
      const second = fact({ requestId: `piiredaction_b${run}`, priceNanoUsd: 523_400_000 });

      // The first call's fact is delivered twice, as a retried ingestion would.
      await spend.recordPiiRedactionSpend({ fact: first });
      await spend.recordPiiRedactionSpend({ fact: first });
      await spend.recordPiiRedactionSpend({ fact: second });

      const result = await client.query({
        query: `
        SELECT GatewayRequestId, Status, RequestType, Model, OrganizationId, VirtualKeyId,
               TokensInput, CostNanoUSD, Metadata
        FROM gateway_spend FINAL
        WHERE TenantId = {tenantId:String}
        ORDER BY GatewayRequestId`,
        query_params: { tenantId: PROJECT },
        format: "JSONEachRow",
      });
      const rows = await result.json<{
        GatewayRequestId: string;
        Status: string;
        RequestType: string;
        Model: string;
        OrganizationId: string;
        VirtualKeyId: string;
        TokensInput: number | string;
        CostNanoUSD: number | string;
        Metadata: string;
      }>();
      expect(rows.map((row) => row.GatewayRequestId)).toEqual([first.requestId, second.requestId]);
      expect(rows[0]).toMatchObject({
        Status: "confirmed",
        RequestType: "pii_redaction",
        Model: "pii-redaction-model",
        OrganizationId: ORGANIZATION,
        VirtualKeyId: "",
      });
      expect(Number(rows[0]?.TokensInput)).toBe(0);
      expect(Number(rows[0]?.CostNanoUSD)).toBe(600_000_000);
      expect(JSON.parse(rows[0]?.Metadata ?? "{}")).toEqual({
        pii_redaction: { cost_usd: 0.000093534, characters: 1_200_000, texts: 3 },
      });

      const total = await GatewaySpendEventsService.create(ledger).sumSpendNanoUsdByRequestType({
        tenantIds: [PROJECT],
        requestType: "pii_redaction",
        fromMs: Date.UTC(2026, 10, 1),
        toMs: Date.UTC(2026, 11, 1),
      });
      expect(total).toBe(1_123_400_000);
    });
  },
);
