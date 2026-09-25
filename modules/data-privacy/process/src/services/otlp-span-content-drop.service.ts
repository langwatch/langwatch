import {
  DROPPED_ATTRIBUTES_MARKER_MAX_KEYS,
  PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
  PRIVACY_DROPPED_MARKER_ATTR,
  matchesAnyAttributePattern,
  type CompiledAttributeMatcher,
  type ResolvedDataPrivacy,
  type SpanContentDropResult,
} from "@langwatch/data-privacy-contract";
import { createLogger } from "@langwatch/observability";
import type { OtlpSpan } from "@langwatch/trace-contract";

import type { DataPrivacyResolution } from "../app/data-privacy.members.ts";
import { ContentDropPolicyService } from "./content-drop-policy.service.ts";

const logger = createLogger("langwatch:data-privacy:content-drop");

/** What one strip removed so far, threaded through the two passes. */
type DropTally = { droppedCount: number; droppedAttributeKeys: Set<string> };

const EMPTY_DROP_RESULT: SpanContentDropResult = {
  droppedCount: 0,
  droppedCategories: [],
  droppedAttributeKeys: [],
};

export interface OtlpSpanContentDropServiceOptions {
  /**
   * Resolves the scope's policy. Narrowed to the one question this service
   * asks — `DataPrivacyService` satisfies it, as does the resolution-only
   * service a process that cannot write a policy composes.
   */
  dataPrivacy: DataPrivacyResolution;
  /**
   * The kill switch (`LANGWATCH_DATA_PRIVACY_ENFORCEMENT`). Off means the
   * span is stored whole, read-path visibility rules are the only
   * protection — ignoring this flag would drop content the operator hasn't asked for.
   */
  nativePolicyEnforced: boolean;
}

/**
 * Removes content at ingestion before the event is immutable; deliberately
 * fail-open: unresolved policies leave the span intact.
 */
export class OtlpSpanContentDropService {
  static create(options: OtlpSpanContentDropServiceOptions): OtlpSpanContentDropService {
    return new OtlpSpanContentDropService(options, ContentDropPolicyService.create());
  }

  private constructor(
    private readonly options: OtlpSpanContentDropServiceOptions,
    private readonly policies: ContentDropPolicyService,
  ) {}

  /**
   * Resolve the project's policy and apply it. Never throws: a resolution or
   * strip failure keeps the span's content and says so in the log.
   */
  async dropSpanContent({
    span,
    projectId,
  }: {
    span: OtlpSpan;
    projectId: string;
  }): Promise<SpanContentDropResult> {
    if (!this.options.nativePolicyEnforced) {
      return { ...EMPTY_DROP_RESULT };
    }

    try {
      const policy = await this.options.dataPrivacy.getResolvedForProject({ projectId });

      return this.stripSpanContent({ span, policy });
    } catch (error) {
      logger.error(
        { error, projectId },
        "data-privacy content drop skipped: policy resolution or strip failed; keeping span content intact (fail-open, still subject to read-time visibility)",
      );

      return { ...EMPTY_DROP_RESULT };
    }
  }

  /**
   * Strips every dropped content key from the span in place; marks dropped
   * categories and custom attribute rules with separate markers.
   */
  stripSpanContent({
    span,
    policy,
  }: {
    span: OtlpSpan;
    policy: ResolvedDataPrivacy;
  }): SpanContentDropResult {
    const droppedKeys = this.policies.droppedKeys(policy);
    const dropMatchers = this.policies.dropMatchers(policy);
    if (droppedKeys.size === 0 && dropMatchers.length === 0) {
      return { ...EMPTY_DROP_RESULT };
    }

    const tally: DropTally = { droppedCount: 0, droppedAttributeKeys: new Set<string>() };
    // Role-based categories (system, tools) also live inside the captured
    // input/output conversation, so strip those roles from every surviving
    // chat-message array. Done before canonicalization can re-derive
    // gen_ai.system_instructions from a system turn that was left behind.
    const roleStrip = this.policies.rolesDroppedFromChatArrays(policy);
    const pass = (attributes: OtlpSpan["attributes"]): OtlpSpan["attributes"] =>
      this.stripRoles(
        this.stripKeys(attributes, { droppedKeys, dropMatchers }, tally),
        roleStrip,
        tally,
      );

    span.attributes = pass(span.attributes);
    for (const event of span.events) {
      event.attributes = pass(event.attributes);
    }

    const categories = this.policies.droppedCategories(policy);
    const droppedKeyList = [...tally.droppedAttributeKeys];
    this.stampMarkers(span, categories, droppedKeyList);

    return {
      droppedCount: tally.droppedCount,
      droppedCategories: categories,
      droppedAttributeKeys: droppedKeyList,
    };
  }

  /** Drop the policy's exact catalog keys and its wildcard custom matches. */
  private stripKeys(
    attributes: OtlpSpan["attributes"],
    rules: { droppedKeys: Set<string>; dropMatchers: CompiledAttributeMatcher[] },
    tally: DropTally,
  ): OtlpSpan["attributes"] {
    return attributes.filter((attr) => {
      if (rules.droppedKeys.has(attr.key)) {
        tally.droppedCount++;

        return false;
      }

      if (matchesAnyAttributePattern(attr.key, rules.dropMatchers)) {
        tally.droppedCount++;
        tally.droppedAttributeKeys.add(attr.key);

        return false;
      }

      return true;
    });
  }

  /** Remove dropped message roles from every surviving conversation. */
  private stripRoles(
    attributes: OtlpSpan["attributes"],
    roleStrip: { roles: Set<string>; stripToolCalls: boolean },
    tally: DropTally,
  ): OtlpSpan["attributes"] {
    if (roleStrip.roles.size === 0 && !roleStrip.stripToolCalls) {
      return attributes;
    }

    return attributes.map((attr) => {
      const stringValue = attr.value?.stringValue;
      if (!this.policies.isChatArrayKey(attr.key) || typeof stringValue !== "string") {
        return attr;
      }

      const result = this.policies.deriveRoleStrippedChatArrayJson(
        stringValue,
        roleStrip.roles,
        roleStrip.stripToolCalls,
      );
      if (result.kind === "unchanged") {
        return attr;
      }

      tally.droppedCount += result.removed;

      return { ...attr, value: { ...attr.value, stringValue: result.json } };
    });
  }

  /**
   * Stamp what was removed. A marker is the only evidence the pass ran, since
   * the pre-drop span is never stored, and the attribute marker carries key
   * NAMES only — never a value the policy just removed.
   */
  private stampMarkers(span: OtlpSpan, categories: string[], droppedAttributeKeys: string[]): void {
    const stamp = (key: string, value: string) => {
      span.attributes = span.attributes.filter((attr) => attr.key !== key);
      span.attributes.push({ key, value: { stringValue: value } });
    };

    if (categories.length > 0) {
      stamp(PRIVACY_DROPPED_MARKER_ATTR, categories.join(","));
    }

    if (droppedAttributeKeys.length > 0) {
      stamp(
        PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR,
        droppedAttributeKeys.slice(0, DROPPED_ATTRIBUTES_MARKER_MAX_KEYS).join(","),
      );
    }
  }
}
