/**
 * @vitest-environment node
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";
import { refusingStoredObjectFeature } from "../stored-object.composition.ts";

describe("the object store's payload staging port", () => {
  describe("given a process that composed no object storage", () => {
    describe("when a payload needs staging", () => {
      // The port is a REQUIRED collaborator of the NLP and langevals
      // transports, so the absence has to be a refusal by name rather than a
      // silently skipped upload that reappears as a 6 MB Lambda body error.
      it("is composed, and refuses by name rather than being absent", () => {
        const staging = refusingStoredObjectFeature().payloadStaging;

        expect(staging).toBeDefined();
        let thrown: unknown;
        try {
          staging.stage({
            projectId: "project-1",
            keyPrefix: "nlpgo-staging/project-1",
            serialized: Buffer.from("{}"),
            ttlSeconds: 60,
          });
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(HandledError);
        expect((thrown as HandledError).code).toBe("service_unavailable");
      });
    });
  });
});
