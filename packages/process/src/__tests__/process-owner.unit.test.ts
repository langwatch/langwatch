import {
  nlpCodeBlockTimeoutSeconds,
  nlpServiceUrl,
  parseProcessConfig,
  publicBaseUrl,
} from "@langwatch/config";
import {
  nlpInternalSecret,
  refuseDoubleClaims,
  Secret,
  SecretClaimedTwiceError,
} from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { processOwner } from "../owner.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [processOwner], environment }).process;

describe("the process owner's own declaration", () => {
  describe("given a deployment states its public origin", () => {
    it("reads it, and treats blank as having named none", () => {
      expect(read({ BASE_HOST: "https://app.langwatch.test" }).baseHost).toBe(
        "https://app.langwatch.test",
      );
      expect(read({ BASE_HOST: "   " }).baseHost).toBeUndefined();
      expect(read({}).baseHost).toBeUndefined();
    });
  });

  describe("given a module holding the shared public origin leaf beside the process", () => {
    /** @scenario "The process and a module both holding the public origin leaf parse it" */
    it("parses BASE_HOST once for both, with no collision", () => {
      const automation = { name: "automation", config: { publicBaseUrl } } as const;

      const config = parseProcessConfig({
        owners: [processOwner, automation],
        environment: { BASE_HOST: " https://app.langwatch.test " },
      });

      expect(config.process.baseHost).toBe("https://app.langwatch.test");
      expect(config.automation.publicBaseUrl).toBe("https://app.langwatch.test");
    });
  });

  describe("given a module holding the shared engine address leaf beside the process", () => {
    /** @scenario "The process and a module both holding the engine address leaf parse it" */
    it("parses LANGWATCH_NLP_SERVICE once for both, with no collision", () => {
      const evaluation = { name: "evaluation", config: { nlpServiceUrl } } as const;

      const config = parseProcessConfig({
        owners: [processOwner, evaluation],
        environment: { LANGWATCH_NLP_SERVICE: " http://nlp.langwatch.test " },
      });

      expect(config.process.nlpServiceUrl).toBe("http://nlp.langwatch.test");
      expect(config.evaluation.nlpServiceUrl).toBe("http://nlp.langwatch.test");
    });
  });

  describe("given a module holding the shared code-block timeout leaf beside the process", () => {
    /** @scenario "The process and a module both holding the code-block timeout leaf parse it" */
    it("parses NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS once for both, raw", () => {
      const scenario = { name: "scenario", config: { nlpCodeBlockTimeoutSeconds } } as const;

      const config = parseProcessConfig({
        owners: [processOwner, scenario],
        environment: { NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS: "9000" },
      });

      expect(config.process.nlpCodeBlockTimeoutSeconds).toBe("9000");
      expect(config.scenario.nlpCodeBlockTimeoutSeconds).toBe("9000");
    });
  });

  describe("given a module claiming the engine credential beside the process", () => {
    /** @scenario "The process and a module both holding the engine credential handle boot" */
    it("admits the shared handle and refuses a fresh one, naming the process", () => {
      expect(() =>
        refuseDoubleClaims([
          processOwner,
          { name: "evaluation", secrets: { nlpInternal: nlpInternalSecret } },
        ]),
      ).not.toThrow();

      const fresh = Secret.load("LANGWATCH_NLP_INTERNAL_SECRET", { optional: true });
      const refusal = (() => {
        try {
          refuseDoubleClaims([processOwner, { name: "evaluation", secrets: { fresh } }]);
        } catch (error) {
          return error;
        }
        return void 0;
      })();

      expect(refusal).toBeInstanceOf(SecretClaimedTwiceError);
      expect((refusal as SecretClaimedTwiceError).owners).toEqual(["process", "evaluation"]);
    });
  });

  describe("given the deployment flag", () => {
    it("recognizes both spellings without enabling an absent flag", () => {
      expect(read({ IS_SAAS: "1" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "true" }).isSaas).toBe(true);
      expect(read({ IS_SAAS: "false" }).isSaas).toBe(false);
      expect(read({}).isSaas).toBe(false);
    });
  });

  describe("given an environment name", () => {
    it("carries it raw, so a reader decides what counts as production", () => {
      expect(read({ NODE_ENV: "production" }).nodeEnvironment).toBe("production");
      expect(read({}).nodeEnvironment).toBeUndefined();
    });
  });

  describe("given a deployment sets the standard proxy variables", () => {
    it("reads each spelling once, for every module's outbound calls to follow", () => {
      const { outboundProxy } = read({ https_proxy: "http://proxy.corp:8080", NO_PROXY: ".corp" });

      expect(outboundProxy.https_proxy).toBe("http://proxy.corp:8080");
      expect(outboundProxy.NO_PROXY).toBe(".corp");
    });
  });
});
