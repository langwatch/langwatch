import type { MetricDataPointPreparation } from "@langwatch/metric-contract";
import { describe, expect, it } from "vitest";
import {
  MetricPreparationPort,
  type MetricPreparationInput,
} from "../../ports/metric-preparation.port";
import { MetricService } from "../metric.service";

class RecordingPreparationPort extends MetricPreparationPort {
  input: MetricPreparationInput | null = null;

  async prepare(input: MetricPreparationInput): Promise<MetricDataPointPreparation> {
    this.input = input;
    return { accepted: [], rejectedDataPoints: 0, errors: [] };
  }
}

describe("MetricService", () => {
  it("delegates canonical preparation to its composed preparation service", async () => {
    const preparation = new RecordingPreparationPort();
    const service = MetricService.create({ preparation });

    await service.prepareMetricDataPoints({
      tenantId: "project_1",
      organizationId: "organization_1",
      request: { resourceMetrics: [] },
      piiRedactionLevel: "STRICT",
      acceptedAt: 1_774_560_000_000,
    });

    expect(preparation.input).toEqual({
      tenantId: "project_1",
      organizationId: "organization_1",
      request: { resourceMetrics: [] },
      piiRedactionLevel: "STRICT",
      acceptedAt: 1_774_560_000_000,
    });
  });
});
