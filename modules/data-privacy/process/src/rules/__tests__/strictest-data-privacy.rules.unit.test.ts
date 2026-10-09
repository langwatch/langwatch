import {
  EMPTY_AUDIENCE,
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type ResolvedAudience,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { ESSENTIAL_PII_ENTITIES } from "@langwatch/redaction";
/**
 * ADR-144 decision 9: an aggregate read applies the most restrictive privacy
 * policy across the projects its proof reads. These pin each rule of that
 * fold, one concern at a time.
 */
import { describe, expect, it } from "vitest";

import { strictestDataPrivacy } from "../strictest-data-privacy.rules.ts";

function policy(overrides: Partial<ResolvedDataPrivacy> = {}): ResolvedDataPrivacy {
  return structuredClone({ ...PLATFORM_DEFAULT_DATA_PRIVACY, ...overrides });
}

function audience(overrides: Partial<ResolvedAudience>): ResolvedAudience {
  return { ...EMPTY_AUDIENCE, ...overrides };
}

function withInput(
  disposition: "capture" | "restrict" | "drop",
  inputAudience: ResolvedAudience = EMPTY_AUDIENCE,
): ResolvedDataPrivacy {
  const base = policy();
  return {
    ...base,
    categories: {
      ...base.categories,
      input: { disposition, audience: inputAudience },
    },
  };
}

describe("strictestDataPrivacy", () => {
  describe("when given no policy", () => {
    it("returns the platform default", () => {
      expect(strictestDataPrivacy([])).toEqual(PLATFORM_DEFAULT_DATA_PRIVACY);
    });
  });

  describe("when given one policy", () => {
    it("returns that policy unchanged", () => {
      const only = withInput("restrict", audience({ admins: true }));

      expect(strictestDataPrivacy([only])).toEqual(only);
    });
  });

  describe("when the members disagree on a content category", () => {
    it("drops when any member drops", () => {
      const folded = strictestDataPrivacy([
        withInput("capture"),
        withInput("drop"),
        withInput("restrict", audience({ admins: true })),
      ]);

      expect(folded.categories.input.disposition).toBe("drop");
    });

    it("restricts to the restricting member's audience over a capture", () => {
      const folded = strictestDataPrivacy([
        withInput("capture"),
        withInput("restrict", audience({ admins: true })),
      ]);

      expect(folded.categories.input).toEqual({
        disposition: "restrict",
        audience: audience({ admins: true }),
      });
    });

    it("keeps a category every member captures as captured", () => {
      const folded = strictestDataPrivacy([withInput("capture"), policy()]);

      expect(folded.categories.input.disposition).toBe("capture");
      expect(folded.categories.output.disposition).toBe("capture");
    });

    it("intersects the audiences when two members restrict", () => {
      const folded = strictestDataPrivacy([
        withInput("restrict", audience({ admins: true, members: true, groupIds: ["g1", "g2"] })),
        withInput("restrict", audience({ admins: true, viewers: true, groupIds: ["g2", "g3"] })),
      ]);

      expect(folded.categories.input).toEqual({
        disposition: "restrict",
        audience: audience({ admins: true, groupIds: ["g2"] }),
      });
    });

    it("reads an all-members audience as everyone, so the other audience is the intersection", () => {
      const folded = strictestDataPrivacy([
        withInput("restrict", audience({ allMembers: true })),
        withInput("restrict", audience({ admins: true, groupIds: ["g1"] })),
      ]);

      expect(folded.categories.input.audience).toEqual(
        audience({ admins: true, groupIds: ["g1"] }),
      );
    });
  });

  describe("when the members disagree on personal data", () => {
    const pii = (
      level: ResolvedDataPrivacy["pii"]["level"],
      entities: string[] = [],
    ): ResolvedDataPrivacy => policy({ pii: { level, entities, exceptPatterns: [] } });

    it("redacts strictly when any member does", () => {
      expect(
        strictestDataPrivacy([pii("custom", ["EMAIL_ADDRESS"]), pii("strict"), pii("disabled")]).pii
          .level,
      ).toBe("strict");
    });

    it("takes essential over disabled", () => {
      expect(strictestDataPrivacy([pii("disabled"), pii("essential")]).pii.level).toBe("essential");
      expect(strictestDataPrivacy([pii("disabled"), pii("disabled")]).pii.level).toBe("disabled");
    });

    it("folds an essential member into a custom one by adding every essential identifier", () => {
      const folded = strictestDataPrivacy([pii("custom", ["PERSON"]), pii("essential")]).pii;

      expect(folded.level).toBe("custom");
      expect([...folded.entities].sort()).toEqual([...ESSENTIAL_PII_ENTITIES, "PERSON"].sort());
    });

    it("unions the entities and keeps only the exceptions every member allows", () => {
      const folded = strictestDataPrivacy([
        policy({
          pii: {
            level: "custom",
            entities: ["EMAIL_ADDRESS"],
            exceptPatterns: ["RES-\\d{6}", "TKT-\\d{4}"],
          },
        }),
        policy({
          pii: {
            level: "custom",
            entities: ["PERSON", "EMAIL_ADDRESS"],
            exceptPatterns: ["TKT-\\d{4}"],
          },
        }),
      ]);

      expect([...folded.pii.entities].sort()).toEqual(["EMAIL_ADDRESS", "PERSON"]);
      expect(folded.pii.exceptPatterns).toEqual(["TKT-\\d{4}"]);
    });
  });

  describe("when the members disagree on secrets", () => {
    it("redacts secrets when any member does and unions the custom patterns", () => {
      const folded = strictestDataPrivacy([
        policy({
          secrets: { enabled: false, customPatterns: ["acme_[a-z]{8}"] },
        }),
        policy({
          secrets: { enabled: true, customPatterns: ["tok_[0-9]{12}"] },
        }),
      ]);

      expect(folded.secrets.enabled).toBe(true);
      expect([...folded.secrets.customPatterns].sort()).toEqual(["acme_[a-z]{8}", "tok_[0-9]{12}"]);
    });

    it("leaves secrets off only when every member leaves them off", () => {
      const off = policy({ secrets: { enabled: false, customPatterns: [] } });

      expect(strictestDataPrivacy([off, off]).secrets.enabled).toBe(false);
    });
  });

  describe("when the members carry custom attribute rules", () => {
    it("unions the rules by pattern", () => {
      const folded = strictestDataPrivacy([
        policy({
          customAttributes: [
            {
              pattern: "a.*",
              disposition: "restrict",
              audience: audience({ admins: true }),
            },
          ],
        }),
        policy({
          customAttributes: [{ pattern: "b.*", disposition: "drop", audience: EMPTY_AUDIENCE }],
        }),
      ]);

      expect(folded.customAttributes.map((rule) => rule.pattern).sort()).toEqual(["a.*", "b.*"]);
    });

    // A drop acts only at ingestion and the read path hides only restricts,
    // so a folded drop would show a restricting member's stored value to
    // everyone. For a read, the strictest of the two is restrict to no one.
    it("restricts to no one when one member drops and another restricts the same pattern", () => {
      const folded = strictestDataPrivacy([
        policy({
          customAttributes: [
            {
              pattern: "a.*",
              disposition: "restrict",
              audience: audience({ admins: true }),
            },
          ],
        }),
        policy({
          customAttributes: [{ pattern: "a.*", disposition: "drop", audience: EMPTY_AUDIENCE }],
        }),
      ]);

      expect(folded.customAttributes).toEqual([
        { pattern: "a.*", disposition: "restrict", audience: EMPTY_AUDIENCE },
      ]);
    });

    it("keeps a drop every member holds as a drop", () => {
      const dropping = policy({
        customAttributes: [{ pattern: "a.*", disposition: "drop", audience: EMPTY_AUDIENCE }],
      });

      expect(strictestDataPrivacy([dropping, dropping]).customAttributes).toEqual([
        { pattern: "a.*", disposition: "drop", audience: EMPTY_AUDIENCE },
      ]);
    });

    it("intersects the audiences when both restrict the same pattern", () => {
      const folded = strictestDataPrivacy([
        policy({
          customAttributes: [
            {
              pattern: "a.*",
              disposition: "restrict",
              audience: audience({ admins: true, members: true }),
            },
          ],
        }),
        policy({
          customAttributes: [
            {
              pattern: "a.*",
              disposition: "restrict",
              audience: audience({ admins: true }),
            },
          ],
        }),
      ]);

      expect(folded.customAttributes).toEqual([
        {
          pattern: "a.*",
          disposition: "restrict",
          audience: audience({ admins: true }),
        },
      ]);
    });
  });
});
