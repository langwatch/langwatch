import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME,
  AutomationSettlementObservabilityService,
} from "../automation-settlement-observability.service.ts";

const inc = vi.hoisted(() => vi.fn());
const counter = vi.hoisted(() => vi.fn((_options: { name: string }) => ({ inc })));

vi.mock("@langwatch/observability/metrics", () => ({ counter }));

describe("AutomationSettlementObservabilityService", () => {
  beforeEach(() => inc.mockClear());

  describe("given a settlement that flushed matches early to stay within its bound", () => {
    /** @scenario "The worker publishes the settlement overflow series" */
    it("publishes the flushed count on the overflow series and not a flush of nothing", () => {
      const observability = AutomationSettlementObservabilityService.create({ capture: vi.fn() });

      observability.recordOverflow(3);
      observability.recordOverflow(0);

      expect(counter).toHaveBeenCalledWith(
        expect.objectContaining({ name: AUTOMATION_OVERFLOW_FLUSH_METRIC_NAME }),
      );
      expect(inc).toHaveBeenCalledTimes(1);
      expect(inc).toHaveBeenCalledWith({}, 3);
    });
  });
});
