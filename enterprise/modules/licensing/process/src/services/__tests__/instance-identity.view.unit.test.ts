/**
 * The identity row as the usage report and the checkup read it: ISO times,
 * and no report fields until a report was sent. Reading never mints.
 * Spec: specs/self-hosting/checkup/checkup.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryInstanceIdentityRepository } from "../../repositories/memory/memory.instance-identity.repository.ts";
import { InstanceIdentityService } from "../instance-identity.service.ts";

const NOW = Temporal.Instant.from("2026-09-21T12:00:00Z");

function identity() {
  return InstanceIdentityService.create({
    repository: MemoryInstanceIdentityRepository.create({ now: () => NOW }),
    newInstanceId: () => "4b1c",
  });
}

describe("InstanceIdentityService.findView", () => {
  describe("given an install that never minted an identity", () => {
    it("answers nothing and mints nothing", async () => {
      const service = identity();

      expect(await service.findView()).toEqual([]);
      expect(await service.findIdentity()).toEqual([]);
    });
  });

  describe("given an install whose last report was refused", () => {
    it("carries the refusal and the switches, with ISO times", async () => {
      const service = identity();
      await service.getInstanceId();
      await service.setReportSwitches({ hostnameOptOut: true });
      await service.recordReport({ error: "usage_report_refused_413", at: NOW });

      const [view] = await service.findView();

      expect(view).toMatchObject({
        instanceId: "4b1c",
        createdAt: "2026-09-21T12:00:00.000Z",
        lastReportError: "usage_report_refused_413",
        optionalMetricsOptOut: false,
        hostnameOptOut: true,
      });
    });
  });
});
