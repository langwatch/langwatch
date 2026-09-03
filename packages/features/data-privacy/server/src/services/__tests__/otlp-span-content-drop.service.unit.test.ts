import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
  PRIVACY_DROPPED_MARKER_ATTR,
  type ContentCategory,
  type DataPrivacyService,
  type Disposition,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { OtlpSpanContentDropService } from "../otlp-span-content-drop.service";

/**
 * Spec: packages/features/data-privacy/specs/span-content-drop.feature
 *
 * The drop is the only pass that can honour a customer's "never store this":
 * the event it runs before is immutable and nothing downstream can take a
 * stored value back. Every assertion here is about content that would
 * otherwise be in ClickHouse with no evidence that it should not have been.
 */

function policy(
  categories: Partial<Record<ContentCategory, Disposition>> = {},
  rules: Array<{ pattern: string; disposition: "drop" | "restrict" }> = [],
): ResolvedDataPrivacy {
  const customAttributes: ResolvedDataPrivacy["customAttributes"] = rules.map((rule) => ({
    ...rule,
    audience: EMPTY_AUDIENCE,
  }));
  const resolved: ResolvedDataPrivacy = {
    ...PLATFORM_DEFAULT_DATA_PRIVACY,
    categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories },
    customAttributes,
  };
  for (const [category, disposition] of Object.entries(categories)) {
    resolved.categories[category as ContentCategory] = {
      ...resolved.categories[category as ContentCategory],
      disposition,
    };
  }
  return resolved;
}

function span(
  attributes: Array<{ key: string; value: { stringValue?: string } }>,
  events: Array<{ attributes: Array<{ key: string; value: { stringValue?: string } }> }> = [],
): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm-call",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 1_000_000, high: 0 },
    attributes,
    events: events.map((event) => ({
      name: "event",
      timeUnixNano: { low: 0, high: 0 },
      attributes: event.attributes,
      droppedAttributesCount: 0,
    })),
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

const keys = (target: OtlpSpan): string[] => target.attributes.map((attr) => attr.key);

/**
 * The strip is pure: it resolves no policy and touches no database. This
 * service is built over a resolver that THROWS, so a strip that reached for one
 * would fail the test rather than quietly acquiring an I/O dependency.
 */
const pureDrop = (): OtlpSpanContentDropService =>
  OtlpSpanContentDropService.create({
    dataPrivacy: {
      getResolvedForProject: () => {
        throw new Error("the strip must not resolve a policy");
      },
    } as unknown as DataPrivacyService,
    nativePolicyEnforced: true,
  });
const marker = (target: OtlpSpan, key: string): string | null | undefined =>
  target.attributes.find((attr) => attr.key === key)?.value.stringValue;

describe("OtlpSpanContentDropService.stripSpanContent", () => {
  describe("given a policy dropping a content category", () => {
    describe("when a span carrying that category is stripped", () => {
      /** @scenario "A dropped category removes every key in its set" */
      it("removes the category's keys and keeps the metadata", () => {
        const target = span([
          { key: "gen_ai.prompt", value: { stringValue: "secret" } },
          { key: "input.value", value: { stringValue: "secret" } },
          { key: "gen_ai.usage.input_tokens", value: { stringValue: "12" } },
          { key: "gen_ai.completion", value: { stringValue: "kept" } },
        ]);

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({ input: "drop" }),
        });

        expect(keys(target)).toEqual([
          "gen_ai.usage.input_tokens",
          "gen_ai.completion",
          PRIVACY_DROPPED_MARKER_ATTR,
        ]);
        expect(result.droppedCount).toBe(2);
        expect(result.droppedCategories).toEqual(["input"]);
      });

      /** @scenario "The drop marker names the dropped categories in catalog order" */
      it("stamps the marker with the categories comma-joined", () => {
        const target = span([{ key: "gen_ai.prompt", value: { stringValue: "secret" } }]);

        pureDrop().stripSpanContent({
          span: target,
          policy: policy({ tools: "drop", input: "drop" }),
        });

        expect(marker(target, PRIVACY_DROPPED_MARKER_ATTR)).toBe("input,tools");
      });

      /** @scenario "A span event's attributes are dropped too" */
      it("strips the same keys from every event", () => {
        const target = span(
          [{ key: "gen_ai.usage.input_tokens", value: { stringValue: "12" } }],
          [{ attributes: [{ key: "gen_ai.prompt", value: { stringValue: "secret" } }] }],
        );

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({ input: "drop" }),
        });

        expect(target.events[0]!.attributes).toEqual([]);
        expect(result.droppedCount).toBe(1);
      });
    });
  });

  describe("given a policy dropping a role-based category", () => {
    describe("when the conversation still carries that role", () => {
      /**
       * @scenario "A dropped system category strips system turns from the conversation"
       *
       * Canonicalisation runs AFTER the drop and re-derives
       * `gen_ai.system_instructions` from the conversation, so removing only
       * the attribute would put the system prompt straight back.
       */
      it("removes the system messages from the chat array", () => {
        const target = span([
          {
            key: "langwatch.input",
            value: {
              stringValue: JSON.stringify([
                { role: "system", content: "you are a bank" },
                { role: "user", content: "hi" },
              ]),
            },
          },
        ]);

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({ system: "drop" }),
        });

        expect(marker(target, "langwatch.input")).toBe(
          JSON.stringify([{ role: "user", content: "hi" }]),
        );
        expect(result.droppedCount).toBe(1);
      });

      /** @scenario "A dropped tools category strips tool turns and assistant tool_calls" */
      it("removes tool and function turns and the tool_calls key", () => {
        const target = span([
          {
            key: "langwatch.output",
            value: {
              stringValue: JSON.stringify({
                type: "chat_messages",
                value: [
                  { role: "assistant", content: "ok", tool_calls: [{ id: "1" }] },
                  { role: "tool", content: "result" },
                  { role: "function", content: "result" },
                  { role: "user", content: "hi" },
                ],
              }),
            },
          },
        ]);

        pureDrop().stripSpanContent({
          span: target,
          policy: policy({ tools: "drop" }),
        });

        expect(marker(target, "langwatch.output")).toBe(
          JSON.stringify({
            type: "chat_messages",
            value: [
              { role: "assistant", content: "ok" },
              { role: "user", content: "hi" },
            ],
          }),
        );
      });

      /** @scenario "A value that is not a conversation is left untouched" */
      it("leaves an unparseable chat-array value alone", () => {
        const target = span([{ key: "langwatch.input", value: { stringValue: "not json" } }]);

        pureDrop().stripSpanContent({
          span: target,
          policy: policy({ system: "drop" }),
        });

        expect(marker(target, "langwatch.input")).toBe("not json");
      });
    });
  });

  describe("given a policy with custom attribute rules", () => {
    describe("when a matching attribute is stripped", () => {
      /** @scenario "Custom attribute rules drop by wildcard and name the keys" */
      it("removes matching keys and lists their names in the second marker", () => {
        const target = span([
          { key: "my.secret.token", value: { stringValue: "shhh" } },
          { key: "my.secret.id", value: { stringValue: "shhh" } },
          { key: "my.public", value: { stringValue: "fine" } },
        ]);

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({}, [{ pattern: "my.secret.*", disposition: "drop" }]),
        });

        expect(keys(target)).toEqual(["my.public", PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR]);
        expect(marker(target, PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR)).toBe(
          "my.secret.token,my.secret.id",
        );
        expect(result.droppedAttributeKeys).toEqual(["my.secret.token", "my.secret.id"]);
      });

      /**
       * @scenario "The dropped-keys marker is capped"
       *
       * The marker lists key NAMES, never values, and a runaway attribute
       * namespace would otherwise put thousands of them on every span.
       */
      it("lists at most twenty keys", () => {
        const target = span(
          Array.from({ length: 25 }, (_unused, index) => ({
            key: `drop.me.${index}`,
            value: { stringValue: "x" },
          })),
        );

        pureDrop().stripSpanContent({
          span: target,
          policy: policy({}, [{ pattern: "drop.me.*", disposition: "drop" }]),
        });

        expect(marker(target, PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR)?.split(",")).toHaveLength(20);
      });

      /** @scenario "A restrict rule is not a drop rule" */
      it("keeps an attribute whose rule only restricts it", () => {
        const target = span([{ key: "my.secret.token", value: { stringValue: "shhh" } }]);

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({}, [{ pattern: "my.secret.*", disposition: "restrict" }]),
        });

        expect(keys(target)).toEqual(["my.secret.token"]);
        expect(result.droppedCount).toBe(0);
      });
    });
  });

  describe("given a policy that drops nothing", () => {
    describe("when a span is stripped", () => {
      /** @scenario "A policy with no drop leaves the span exactly as it arrived" */
      it("stamps no marker and removes nothing", () => {
        const target = span([{ key: "gen_ai.prompt", value: { stringValue: "kept" } }]);

        const result = pureDrop().stripSpanContent({
          span: target,
          policy: policy({}),
        });

        expect(keys(target)).toEqual(["gen_ai.prompt"]);
        expect(result).toEqual({
          droppedCount: 0,
          droppedCategories: [],
          droppedAttributeKeys: [],
        });
      });
    });
  });
});

describe("OtlpSpanContentDropService.dropSpanContent", () => {
  function service(options: {
    policy?: ResolvedDataPrivacy;
    throws?: Error;
    nativePolicyEnforced?: boolean;
  }): {
    drop: OtlpSpanContentDropService;
    getResolvedForProject: ReturnType<typeof vi.fn>;
  } {
    const getResolvedForProject = vi.fn(async () => {
      if (options.throws) throw options.throws;
      return options.policy ?? policy({ input: "drop" });
    });
    return {
      drop: OtlpSpanContentDropService.create({
        dataPrivacy: { getResolvedForProject } as unknown as DataPrivacyService,
        nativePolicyEnforced: options.nativePolicyEnforced ?? true,
      }),
      getResolvedForProject,
    };
  }

  describe("given enforcement is on", () => {
    describe("when a span is dropped for a project", () => {
      /** @scenario "The policy is resolved for the ingesting project" */
      it("resolves the project's own policy and applies it", async () => {
        const { drop, getResolvedForProject } = service({});
        const target = span([{ key: "gen_ai.prompt", value: { stringValue: "secret" } }]);

        const result = await drop.dropSpanContent({ span: target, projectId: "project-3" });

        expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project-3" });
        expect(keys(target)).toEqual([PRIVACY_DROPPED_MARKER_ATTR]);
        expect(result.droppedCount).toBe(1);
      });
    });

    describe("when the policy cannot be resolved", () => {
      /**
       * @scenario "A policy that cannot be resolved fails open"
       *
       * Fail-open is the deliberate direction: the alternative is dropping a
       * customer's content on a guess, and the read path's visibility rules
       * still apply to whatever is stored.
       */
      it("keeps the span's content and reports nothing dropped", async () => {
        const { drop } = service({ throws: new Error("postgres is down") });
        const target = span([{ key: "gen_ai.prompt", value: { stringValue: "secret" } }]);

        const result = await drop.dropSpanContent({ span: target, projectId: "project-3" });

        expect(keys(target)).toEqual(["gen_ai.prompt"]);
        expect(result).toEqual({
          droppedCount: 0,
          droppedCategories: [],
          droppedAttributeKeys: [],
        });
      });
    });
  });

  describe("given enforcement is off", () => {
    describe("when a span is dropped for a project", () => {
      /**
       * @scenario "With enforcement off nothing is dropped and no policy is read"
       *
       * This is the operator's kill switch. A process that resolved the policy
       * anyway would remove content on a deployment that has not turned native
       * enforcement on.
       */
      it("never resolves a policy and leaves the span whole", async () => {
        const { drop, getResolvedForProject } = service({ nativePolicyEnforced: false });
        const target = span([{ key: "gen_ai.prompt", value: { stringValue: "secret" } }]);

        const result = await drop.dropSpanContent({ span: target, projectId: "project-3" });

        expect(getResolvedForProject).not.toHaveBeenCalled();
        expect(keys(target)).toEqual(["gen_ai.prompt"]);
        expect(result.droppedCount).toBe(0);
      });
    });
  });
});
