/**
 * The engine's staged-payload guard against the live nlpgo binary. The off-S3
 * host is unreachable on purpose, so an immediate 4xx proves the guard ran
 * ahead of any fetch. @see specs/nlp-go/lambda-invoke-payload-staging.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasGo, type NlpgoSubprocess, startNlpgoSubprocess } from "../nlpgo-subprocess";

// Unique port alongside the other nlpgo subprocess integration tests
// (55610 / 55611 / 55612 / 55613 / 55620 — see CLAUDE.md). 55614 is this one's.
const NLPGO_PORT = 55614;

/**
 * The header the receiver reads the presigned URL from, spelled out rather than
 * imported: this test is about the wire between two of its three readers.
 */
const STAGED_PAYLOAD_HEADER = "X-Payload-S3-URL";

describe.skipIf(!hasGo())("the engine's staged-payload guard", () => {
  let nlpgo: NlpgoSubprocess;

  beforeAll(async () => {
    nlpgo = await startNlpgoSubprocess({ port: NLPGO_PORT });
  }, 700_000);

  afterAll(async () => {
    await nlpgo?.stop();
  });

  describe("given a staged-payload header whose host is not an AWS S3 host", () => {
    describe("when the engine receives the invoke", () => {
      /** @scenario "The engine refuses a staged-payload header pointing off S3" */
      it("rejects the request rather than fetching what the header names", async () => {
        const started = Date.now();

        const response = await fetch(`${nlpgo.baseUrl}/go/studio/execute_sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [STAGED_PAYLOAD_HEADER]: "https://evil.example.com/staged.json?sig=x",
          },
          body: "",
        });

        expect(response.status).toBe(400);
        expect(Date.now() - started).toBeLessThan(5_000);
      });

      /** @scenario "The engine refuses a staged-payload header pointing off S3" */
      it("refuses a link-local address the same way", async () => {
        const response = await fetch(`${nlpgo.baseUrl}/go/studio/execute_sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [STAGED_PAYLOAD_HEADER]: "https://169.254.169.254/latest/meta-data",
          },
          body: "",
        });

        expect(response.status).toBe(400);
      });
    });
  });
});
