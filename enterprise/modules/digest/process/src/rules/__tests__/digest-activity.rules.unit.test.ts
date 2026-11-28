// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What an owner's event contributes to a week: the repository a
 * coding-agent fact names, and which metric series the digest sums.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import type { MetricFactsContribution } from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import { extractRepository, metricSeries } from "../digest-activity.rules.ts";

/** One converged series of a session, under the wire name `metricName`. */
const seriesNamed = (metricName: string): MetricFactsContribution => ({
  tenantId: "project-1",
  sessionId: "session-1",
  sessionKeySource: "provider",
  agent: "claude_code",
  occurredAt: 1_000,
  seriesId: `session-1:${metricName}`,
  metricName,
  unit: null,
  attributes: { type: "added" },
  value: 42,
  dataPointCount: 1,
  asOfUnixMs: 1_000,
});

describe("extractRepository()", () => {
  describe("when the fact carries an owner and a name", () => {
    /** @scenario "A coding-agent repository is named with its owner when one was reported" */
    it("names the repository owner/name", () => {
      const repository = extractRepository({ repositoryOwner: "acme", repositoryName: "agent" });

      expect(repository).toBe("acme/agent");
    });
  });

  describe("when the fact carries a name but no owner", () => {
    /** @scenario "A coding-agent repository is named with its owner when one was reported" */
    it("names the repository by its name alone", () => {
      expect(extractRepository({ repositoryName: "scratch" })).toBe("scratch");
    });
  });

  describe("when the fact carries no name", () => {
    /** @scenario "A coding-agent repository is named with its owner when one was reported" */
    it("names no repository, even with an owner", () => {
      expect(extractRepository({ repositoryOwner: "langwatch" })).toBeUndefined();
    });
  });
});

describe("metricSeries()", () => {
  describe("when the contract normalises the metric's name", () => {
    /** @scenario "A coding-agent metric the digest does not sum is not folded" */
    it("reads the series under the normalised name", () => {
      expect(metricSeries(seriesNamed("claude_code.lines_of_code.count"))).toEqual({
        seriesId: "session-1:claude_code.lines_of_code.count",
        metric: "lines_of_code",
        type: "added",
        value: 42,
      });
    });
  });

  describe("when the contract does not normalise the metric's name", () => {
    /** @scenario "A coding-agent metric the digest does not sum is not folded" */
    it("reads no series", () => {
      expect(metricSeries(seriesNamed("claude_code.not_a_known_metric"))).toBeNull();
    });
  });
});
