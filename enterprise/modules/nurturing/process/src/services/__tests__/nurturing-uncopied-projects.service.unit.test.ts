// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  queueRetryElapsedMs,
  UNCOPIED_PROJECT_RETRY_WINDOW_MS,
} from "../../rules/nurturing-project-usage.rules.ts";
import { NurturingUncopiedProjectsService } from "../nurturing-uncopied-projects.service.ts";

/** The last delivery attempt whose next retry still lands inside the window, read off the constant. */
function lastRetryingAttempt(): number {
  let attempt = 1;
  while (queueRetryElapsedMs({ attempt: attempt + 2 }) <= UNCOPIED_PROJECT_RETRY_WINDOW_MS) {
    attempt++;
  }
  return attempt;
}

describe("given the uncopied projects", () => {
  describe("when a project's batch is delivered inside the retry window", () => {
    it("retries every attempt whose next retry lands inside the window", () => {
      const service = NurturingUncopiedProjectsService.create();

      for (let attempt = 1; attempt <= lastRetryingAttempt(); attempt++) {
        expect(service.outcomeOf({ projectId: "a", deliveryAttempt: attempt })).toBe("retry");
      }
    });
  });

  describe("when a project's batch runs out of retries", () => {
    it("drops it, and drops the project's later batches at once", () => {
      const service = NurturingUncopiedProjectsService.create();

      expect(
        service.outcomeOf({ projectId: "a", deliveryAttempt: lastRetryingAttempt() + 1 }),
      ).toBe("drop");
      expect(service.outcomeOf({ projectId: "a", deliveryAttempt: 1 })).toBe("drop");
      expect(service.outcomeOf({ projectId: "b", deliveryAttempt: 1 })).toBe("retry");
    });
  });

  describe("when more projects are dropped than the cap allows", () => {
    it("evicts the least recently used one and keeps a recently hit one", () => {
      const service = NurturingUncopiedProjectsService.create({ maxEntries: 2 });
      const exhausted = lastRetryingAttempt() + 1;

      service.outcomeOf({ projectId: "a", deliveryAttempt: exhausted });
      service.outcomeOf({ projectId: "b", deliveryAttempt: exhausted });
      service.outcomeOf({ projectId: "a", deliveryAttempt: 1 });
      service.outcomeOf({ projectId: "c", deliveryAttempt: exhausted });

      expect(service.outcomeOf({ projectId: "a", deliveryAttempt: 1 })).toBe("drop");
      expect(service.outcomeOf({ projectId: "c", deliveryAttempt: 1 })).toBe("drop");
      expect(service.outcomeOf({ projectId: "b", deliveryAttempt: 1 })).toBe("retry");
    });
  });
});
