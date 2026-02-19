import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const stubSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "test",
  kind: "CLIENT",
  instrumentationScope: { name: "test", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

describe("CanonicalizeSpanAttributesService — metadata handling", () => {
  describe("when Python SDK sends metadata JSON blob", () => {
    it("promotes user_id to langwatch.user.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ user_id: "user-42" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.user.id"]).toBe("user-42");
    });

    it("promotes userId (camelCase variant) to langwatch.user.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ userId: "user-43" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.user.id"]).toBe("user-43");
    });

    it("promotes thread_id to gen_ai.conversation.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ thread_id: "thread-100" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe("thread-100");
    });

    it("promotes threadId (camelCase variant) to gen_ai.conversation.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ threadId: "thread-101" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe("thread-101");
    });

    it("promotes customer_id to langwatch.customer.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ customer_id: "cust-1" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.customer.id"]).toBe("cust-1");
    });

    it("promotes customerId (camelCase variant) to langwatch.customer.id", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ customerId: "cust-2" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.customer.id"]).toBe("cust-2");
    });

    it("promotes labels array to langwatch.labels", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ labels: ["prod", "v2"] }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.labels"]).toBe(
        JSON.stringify(["prod", "v2"]),
      );
    });

    it("preserves raw metadata attribute in output (uses get, not take)", () => {
      const metadata = JSON.stringify({
        user_id: "user-42",
        custom_field: "value",
      });
      const result = service.canonicalize(
        { metadata },
        [],
        stubSpan as any,
      );

      // metadata is read with get() (not take()), so it stays in remaining()
      expect(result.attributes["metadata"]).toBe(metadata);
    });
  });

  describe("when langwatch.metadata is used instead of metadata", () => {
    it("promotes user_id from langwatch.metadata to langwatch.user.id", () => {
      const result = service.canonicalize(
        {
          "langwatch.metadata": JSON.stringify({ user_id: "lw-user-1" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.user.id"]).toBe("lw-user-1");
    });

    it("promotes thread_id from langwatch.metadata to gen_ai.conversation.id", () => {
      const result = service.canonicalize(
        {
          "langwatch.metadata": JSON.stringify({ thread_id: "lw-thread-1" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe("lw-thread-1");
    });

    it("promotes customer_id from langwatch.metadata", () => {
      const result = service.canonicalize(
        {
          "langwatch.metadata": JSON.stringify({ customer_id: "lw-cust-1" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.customer.id"]).toBe("lw-cust-1");
    });

    it("promotes labels from langwatch.metadata", () => {
      const result = service.canonicalize(
        {
          "langwatch.metadata": JSON.stringify({ labels: ["beta"] }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.labels"]).toBe(
        JSON.stringify(["beta"]),
      );
    });

    it("prefers metadata over langwatch.metadata when both present", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify({ user_id: "from-metadata" }),
          "langwatch.metadata": JSON.stringify({ user_id: "from-lw-metadata" }),
        },
        [],
        stubSpan as any,
      );

      // "metadata" is checked first via ??, so it wins
      expect(result.attributes["langwatch.user.id"]).toBe("from-metadata");
    });
  });

  describe("when explicit attributes conflict with metadata", () => {
    it("prefers explicit langwatch.user.id over metadata user_id", () => {
      const result = service.canonicalize(
        {
          "langwatch.user.id": "explicit-user",
          metadata: JSON.stringify({ user_id: "meta-user" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.user.id"]).toBe("explicit-user");
    });

    it("prefers explicit langwatch.thread.id over metadata thread_id", () => {
      const result = service.canonicalize(
        {
          "langwatch.thread.id": "explicit-thread",
          metadata: JSON.stringify({ thread_id: "meta-thread" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe(
        "explicit-thread",
      );
    });

    it("prefers explicit langwatch.customer.id over metadata customer_id", () => {
      const result = service.canonicalize(
        {
          "langwatch.customer.id": "explicit-cust",
          metadata: JSON.stringify({ customer_id: "meta-cust" }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.customer.id"]).toBe("explicit-cust");
    });

    it("prefers explicit langwatch.labels over metadata labels", () => {
      const result = service.canonicalize(
        {
          "langwatch.labels": JSON.stringify(["explicit"]),
          metadata: JSON.stringify({ labels: ["meta"] }),
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.labels"]).toBe(
        JSON.stringify(["explicit"]),
      );
    });
  });

  describe("when metadata JSON is malformed", () => {
    it("preserves raw metadata string when JSON is invalid", () => {
      const result = service.canonicalize(
        {
          metadata: "not valid json {{{",
        },
        [],
        stubSpan as any,
      );

      // metadata stays in remaining as-is since parse fails
      expect(result.attributes["metadata"]).toBe("not valid json {{{");
      // No promoted fields
      expect(result.attributes["langwatch.user.id"]).toBeUndefined();
    });

    it("ignores metadata when value is not a JSON object", () => {
      const result = service.canonicalize(
        {
          metadata: JSON.stringify([1, 2, 3]),
        },
        [],
        stubSpan as any,
      );

      // Array is not a JSON object, so no field promotion
      expect(result.attributes["langwatch.user.id"]).toBeUndefined();
      // metadata still preserved in remaining
      expect(result.attributes["metadata"]).toBe(JSON.stringify([1, 2, 3]));
    });
  });

  describe("when TS SDK sends direct attributes", () => {
    it("maps langwatch.thread.id to gen_ai.conversation.id via take", () => {
      const result = service.canonicalize(
        {
          "langwatch.thread.id": "ts-thread-1",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe("ts-thread-1");
      // langwatch.thread.id is consumed (taken), so it should not appear in output
      expect(result.attributes["langwatch.thread.id"]).toBeUndefined();
    });

    it("maps legacy thread_id to gen_ai.conversation.id", () => {
      const result = service.canonicalize(
        {
          thread_id: "legacy-thread-1",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.conversation.id"]).toBe(
        "legacy-thread-1",
      );
    });

    it("passes through langwatch.user.id", () => {
      const result = service.canonicalize(
        {
          "langwatch.user.id": "user-direct",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.user.id"]).toBe("user-direct");
    });

    it("passes through langwatch.customer.id", () => {
      const result = service.canonicalize(
        {
          "langwatch.customer.id": "cust-direct",
        },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.customer.id"]).toBe("cust-direct");
    });
  });
});
