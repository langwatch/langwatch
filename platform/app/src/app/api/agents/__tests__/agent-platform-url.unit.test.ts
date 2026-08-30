import { describe, expect, it } from "vitest";
import { agentPlatformUrl } from "../agent-platform-url";

describe("agentPlatformUrl", () => {
  describe("given an agent of each type", () => {
    it("opens the drawer that edits or shows that type", () => {
      const drawerOf = (agentType: string) =>
        new URL(
          agentPlatformUrl({ projectSlug: "acme", agentId: "agent_1", agentType }),
        ).searchParams.get("drawer.open");

      expect(drawerOf("http")).toBe("agentHttpEditor");
      expect(drawerOf("connected")).toBe("agentConnectedDetail");
      expect(drawerOf("code")).toBe("agentCodeEditor");
      expect(drawerOf("workflow")).toBe("agentCodeEditor");
    });
  });
});
