/**
 * With the secret resolved, X-LangWatch-NLP-Secret reaches the engine; with it
 * unset nothing is sent and nothing throws, which is what keeps an install
 * predating the variable booting and running.
 */
import { describe, expect, it } from "vitest";

import {
  NLP_INTERNAL_SECRET_ENV,
  NLP_INTERNAL_SECRET_HEADER,
  nlpInternalSecretHeaders,
} from "../nlp-internal-secret.ts";

describe("the NLP engine's internal secret header", () => {
  describe("given the deployment named a secret", () => {
    /** @scenario "the shared helper carries the secret when one is configured" */
    it("carries it as X-LangWatch-NLP-Secret", () => {
      expect(nlpInternalSecretHeaders({ secret: "s3cr3t" })).toEqual({
        [NLP_INTERNAL_SECRET_HEADER]: "s3cr3t",
      });
    });

    it("trims surrounding whitespace so a padded configuration line still matches", () => {
      expect(nlpInternalSecretHeaders({ secret: "  s3cr3t  " })).toEqual({
        [NLP_INTERNAL_SECRET_HEADER]: "s3cr3t",
      });
    });
  });

  describe("given the deployment named none", () => {
    /** @scenario "the shared helper carries nothing when none is configured" */
    it("carries no header at all", () => {
      expect(nlpInternalSecretHeaders({ secret: void 0 })).toEqual({});
    });

    it("treats a blank value as naming none", () => {
      expect(nlpInternalSecretHeaders({ secret: "   " })).toEqual({});
    });
  });

  describe("given the two readers of the variable", () => {
    it("names it once, so the writer and the child cannot drift on a typo", () => {
      expect(NLP_INTERNAL_SECRET_ENV).toBe("LANGWATCH_NLP_INTERNAL_SECRET");
    });
  });
});
