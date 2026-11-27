import { describe, expect, it } from "vitest";

import { langWatchQLKeyReachSchema } from "../../../index.ts";

const API_KEY = {
  kind: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
} as const;

describe("the LangWatchQL key reach", () => {
  describe("given the credential the key door resolves", () => {
    /** @scenario "A Langy session key runs a LangWatchQL query and reads its schema and reference" */
    it("accepts a Langy session key and keeps its flag", () => {
      const langy = {
        ...API_KEY,
        resolvedProject: { id: "project-1", teamId: "team-1" },
        isLangySessionKey: true,
      };

      expect(langWatchQLKeyReachSchema.parse(langy)).toEqual(langy);
    });

    /** @scenario "An organization key whose credential carries no Langy flag still runs a query" */
    it("accepts an organization key whose Langy flag is absent or undefined", () => {
      expect(langWatchQLKeyReachSchema.parse(API_KEY)).toEqual(API_KEY);
      expect(
        langWatchQLKeyReachSchema.parse({ ...API_KEY, isLangySessionKey: undefined }),
      ).toMatchObject(API_KEY);
    });

    /** @scenario "A project-bound access token runs a LangWatchQL query as its person" */
    it("accepts a project-bound access token as its person", () => {
      const token = {
        kind: "cliAccessToken",
        userId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        teamId: "team-1",
      } as const;

      expect(langWatchQLKeyReachSchema.parse(token)).toEqual(token);
    });

    it("still refuses a key carrying a field the door never resolves", () => {
      expect(() => langWatchQLKeyReachSchema.parse({ ...API_KEY, smuggled: true })).toThrow(
        /smuggled/,
      );
    });
  });
});
