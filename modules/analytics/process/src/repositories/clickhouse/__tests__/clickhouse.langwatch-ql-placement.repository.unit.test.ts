/**
 * The placement the LangWatchQL gate reads is the routed client's own answer, translated: any
 * target but `shared` is a private route, and the recorded flag and origin pass through (ADR-200).
 * Spec: specs/lwql/isolation.feature
 */
import { type ClickHouseQueryClient, SHARED_CLICKHOUSE_TARGET } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ClickHouseLangWatchQLPlacementRepository } from "../clickhouse.langwatch-ql-placement.repository.ts";

type RoutedPlacement = Awaited<ReturnType<ClickHouseQueryClient["placementOf"]>>;

function placementOver(answer: RoutedPlacement) {
  const asked: string[] = [];
  const repository = ClickHouseLangWatchQLPlacementRepository.create({
    clickhouse: createApiFixture<ClickHouseQueryClient>({
      placementOf: ({ tenantId }) => {
        asked.push(tenantId);
        return Promise.resolve(answer);
      },
    }),
  });
  return { repository, asked };
}

describe("ClickHouseLangWatchQLPlacementRepository", () => {
  describe("given the routed client resolves the tenant to its organisation's own server", () => {
    it("reports it routed privately, with the recorded flag and origin as the client gave them", async () => {
      const { repository, asked } = placementOver({
        target: "org-routed",
        recordedPrivate: true,
        origin: "https://routed.example:8443",
      });

      expect(await repository.placementOf({ tenantId: "project-routed" })).toEqual({
        recordedPrivate: true,
        routedPrivately: true,
        origin: "https://routed.example:8443",
      });
      expect(asked).toEqual(["project-routed"]);
    });
  });

  describe("given the routed client resolves the tenant to the shared server", () => {
    it("reports it not routed privately", async () => {
      const { repository } = placementOver({
        target: SHARED_CLICKHOUSE_TARGET,
        recordedPrivate: false,
        origin: "http://shared:8123",
      });

      expect(await repository.placementOf({ tenantId: "project-shared" })).toEqual({
        recordedPrivate: false,
        routedPrivately: false,
        origin: "http://shared:8123",
      });
    });
  });

  describe("given a tenant recorded private that resolves to the shared server", () => {
    it("keeps the disagreement for the gate to refuse", async () => {
      const { repository } = placementOver({
        target: SHARED_CLICKHOUSE_TARGET,
        recordedPrivate: true,
        origin: null,
      });

      expect(await repository.placementOf({ tenantId: "project-recorded" })).toEqual({
        recordedPrivate: true,
        routedPrivately: false,
        origin: null,
      });
    });
  });
});
