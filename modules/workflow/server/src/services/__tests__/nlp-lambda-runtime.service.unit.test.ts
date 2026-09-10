/**
 * @vitest-environment node
 * @see specs/nlp-go/studio-lambda-cache.feature
 */
import { describe, expect, it, vi } from "vitest";
import { NlpLambdaArnResolver } from "../../app/workflow.app.ts";
import type { NlpLambdaArnCache } from "../../app/workflow.app.ts";
import {
  NLP_LAMBDA_ARN_CACHE_TTL_SECONDS,
  NlpLambdaRuntimeService,
} from "../nlp-lambda-runtime.service.ts";

const IMAGE = "ecr/foo:v1";
const NEXT_IMAGE = "ecr/foo:v2";
const PROJECT = "projectA";
const ARN = "arn:aws:lambda:eu-central-1:1:function:langwatch_nlp-projectA";

/** A store shared by every runtime built from it, as Redis is by every pod. */
class SharedCache implements NlpLambdaArnCache {
  readonly entries = new Map<string, { value: string; ttlSeconds: number }>();
  readonly reads: string[] = [];
  readonly deleted: string[] = [];
  failReads = false;

  async tryGet(key: string): Promise<string | null> {
    this.reads.push(key);
    if (this.failReads) throw new Error("Redis is unavailable");
    return this.entries.get(key)?.value ?? null;
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    this.entries.set(input.key, { value: input.value, ttlSeconds: input.ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.entries.delete(key);
  }
}

function awsResolver(arn: string = ARN) {
  const resolve = vi.fn(async () => arn);
  const resolver = new (class implements NlpLambdaArnResolver {
    resolve = resolve;
  })();
  return { resolver, resolve };
}

function runtime(options: {
  cache: SharedCache;
  resolver: NlpLambdaArnResolver;
  imageUri?: string;
}) {
  return NlpLambdaRuntimeService.create({
    cache: options.cache,
    resolver: options.resolver,
    imageUri: options.imageUri ?? IMAGE,
  });
}

describe("the per-project NLP Lambda runtime", () => {
  describe("when a project resolves for the first time", () => {
    /** @scenario "A successful resolution is shared for ten minutes" */
    it("shares the ARN and the image it was resolved under, for ten minutes", async () => {
      const cache = new SharedCache();
      const { resolver } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      const stored = cache.entries.get("lambda_arn:projectA");
      expect(stored?.ttlSeconds).toBe(NLP_LAMBDA_ARN_CACHE_TTL_SECONDS);
      expect(JSON.parse(stored!.value)).toEqual({ arn: ARN, imageUri: IMAGE });
    });

    /** @scenario "A successful resolution is shared for ten minutes" */
    it("answers later calls without going back to AWS", async () => {
      const cache = new SharedCache();
      const { resolver, resolve } = awsResolver();
      const engine = runtime({ cache, resolver });

      await engine.resolveArn(PROJECT);
      await engine.resolveArn(PROJECT);
      await engine.resolveArn(PROJECT);

      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A successful resolution is shared for ten minutes" */
    it("warms every other pod, so a fresh runtime resolves nothing", async () => {
      const cache = new SharedCache();
      const first = awsResolver();
      const second = awsResolver();

      await runtime({ cache, resolver: first.resolver }).resolveArn(PROJECT);
      const arn = await runtime({ cache, resolver: second.resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(second.resolve).not.toHaveBeenCalled();
    });
  });

  describe("when a burst of callers miss together on one pod", () => {
    /** @scenario "A concurrent local miss has one AWS resolution" */
    it("collapses them onto one resolution and answers all of them with it", async () => {
      const cache = new SharedCache();
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const resolve = vi.fn(async () => {
        await gate;
        return ARN;
      });
      const resolver = new (class implements NlpLambdaArnResolver {
        resolve = resolve;
      })();
      const engine = runtime({ cache, resolver });

      const callers = Array.from({ length: 25 }, () => engine.resolveArn(PROJECT));
      release!();
      const answers = await Promise.all(callers);

      expect(new Set(answers)).toEqual(new Set([ARN]));
      expect(resolve).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the shared cache cannot be trusted", () => {
    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("resolves from AWS when the cache read fails", async () => {
      const cache = new SharedCache();
      cache.failReads = true;
      const { resolver, resolve } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("resolves from AWS when the stored entry is malformed", async () => {
      const cache = new SharedCache();
      await cache.set({ key: "lambda_arn:projectA", value: "{not json", ttlSeconds: 600 });
      const { resolver, resolve } = awsResolver();

      const arn = await runtime({ cache, resolver }).resolveArn(PROJECT);

      expect(arn).toBe(ARN);
      expect(resolve).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Cache failures and malformed entries fall back to AWS" */
    it("shares nothing when the AWS resolution itself fails", async () => {
      const cache = new SharedCache();
      const resolve = vi.fn(async () => {
        throw new Error("Rate Exceeded.");
      });
      const resolver = new (class implements NlpLambdaArnResolver {
        resolve = resolve as never;
      })();
      const engine = runtime({ cache, resolver });

      await expect(engine.resolveArn(PROJECT)).rejects.toThrow("Rate Exceeded.");

      expect(cache.entries.size).toBe(0);
      // A refusal that stuck would be pinned cluster-wide for the whole window;
      // the next caller must be free to try again.
      await expect(engine.resolveArn(PROJECT)).rejects.toThrow("Rate Exceeded.");
      expect(resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the deployment image changes", () => {
    /** @scenario "An image change deletes a stale cached ARN before refresh" */
    it("drops the stale entry and shares the refreshed one under the new image", async () => {
      const cache = new SharedCache();
      await runtime({ cache, resolver: awsResolver().resolver }).resolveArn(PROJECT);
      const refreshedArn = `${ARN}-v2`;
      const { resolver, resolve } = awsResolver(refreshedArn);

      const arn = await runtime({ cache, resolver, imageUri: NEXT_IMAGE }).resolveArn(PROJECT);

      expect(cache.deleted).toEqual(["lambda_arn:projectA"]);
      expect(arn).toBe(refreshedArn);
      expect(resolve).toHaveBeenCalledWith({ projectId: PROJECT, imageUri: NEXT_IMAGE });
      expect(JSON.parse(cache.entries.get("lambda_arn:projectA")!.value)).toEqual({
        arn: refreshedArn,
        imageUri: NEXT_IMAGE,
      });
    });
  });
});
