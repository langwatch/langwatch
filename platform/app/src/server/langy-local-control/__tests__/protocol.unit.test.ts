import { describe, expect, it } from "vitest";
import {
  LOCAL_CALL_ERROR_CODES,
  LOCAL_TOOL_NAMES,
  localToolCallSchema,
} from "../protocol";

describe("the local control protocol", () => {
  describe("when an edit call is read", () => {
    /** @scenario "An edit can append to the end of a file" */
    it("accepts a replacement and an append, and refuses an empty old text", () => {
      const accepted = localToolCallSchema.safeParse({
        tool: "local_edit",
        params: {
          path: ".env",
          edits: [
            { oldText: "OPENAI_API_KEY=", newText: "OPENAI_API_KEY=sk" },
            { append: "LANGWATCH_ENDPOINT=http://localhost:5560" },
          ],
        },
      });
      expect(accepted.success).toBe(true);

      const refused = localToolCallSchema.safeParse({
        tool: "local_edit",
        params: { path: ".env", edits: [{ oldText: "", newText: "X=1" }] },
      });
      expect(refused.success).toBe(false);
    });
  });

  describe("when the credentials call is read", () => {
    /** @scenario "The app gets the project's key through the developer's own login" */
    it("names the tool, takes only the file and knows the refusal code", () => {
      expect(LOCAL_TOOL_NAMES).toContain("local_langwatch_env");
      expect(LOCAL_CALL_ERROR_CODES).toContain("key_refused");

      const bare = localToolCallSchema.safeParse({
        tool: "local_langwatch_env",
        params: {},
      });
      expect(bare.success).toBe(true);

      const withFile = localToolCallSchema.safeParse({
        tool: "local_langwatch_env",
        params: { path: "app/.env" },
      });
      expect(withFile.success).toBe(true);

      // The key travels in no frame, so a call carrying one is not a call.
      const withKey = localToolCallSchema.safeParse({
        tool: "local_langwatch_env",
        params: { path: ".env", apiKey: "sk-lw-x" },
      });
      expect(withKey.success && "apiKey" in withKey.data.params).toBe(false);
    });
  });
});
