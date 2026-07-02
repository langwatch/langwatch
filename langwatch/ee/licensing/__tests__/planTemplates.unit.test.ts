import { describe, expect, it } from "vitest";
import { GROWTH_TEMPLATE, PRO_TEMPLATE, ENTERPRISE_TEMPLATE, getPlanTemplate } from "../planTemplates";
import { DEFAULT_LIMIT } from "../constants";

describe("PRO_TEMPLATE", () => {
  it("has type PRO", () => {
    expect(PRO_TEMPLATE.type).toBe("PRO");
  });

  it("has name Pro", () => {
    expect(PRO_TEMPLATE.name).toBe("Pro");
  });

  it("has maxMembers of 10", () => {
    expect(PRO_TEMPLATE.maxMembers).toBe(10);
  });

  it("has maxMembersLite of 5", () => {
    expect(PRO_TEMPLATE.maxMembersLite).toBe(5);
  });

  it("has maxMessagesPerMonth of 100000", () => {
    expect(PRO_TEMPLATE.maxMessagesPerMonth).toBe(100000);
  });

  it("has canPublish true", () => {
    expect(PRO_TEMPLATE.canPublish).toBe(true);
  });

  it("has usageUnit of traces", () => {
    expect(PRO_TEMPLATE.usageUnit).toBe("traces");
  });
});

describe("ENTERPRISE_TEMPLATE", () => {
  it("has type ENTERPRISE", () => {
    expect(ENTERPRISE_TEMPLATE.type).toBe("ENTERPRISE");
  });

  it("has name Enterprise", () => {
    expect(ENTERPRISE_TEMPLATE.name).toBe("Enterprise");
  });

  it("has maxMembers of 100", () => {
    expect(ENTERPRISE_TEMPLATE.maxMembers).toBe(100);
  });

  it("has maxMembersLite of 50", () => {
    expect(ENTERPRISE_TEMPLATE.maxMembersLite).toBe(50);
  });

  it("has maxMessagesPerMonth of 10000000", () => {
    expect(ENTERPRISE_TEMPLATE.maxMessagesPerMonth).toBe(10000000);
  });

  it("has canPublish true", () => {
    expect(ENTERPRISE_TEMPLATE.canPublish).toBe(true);
  });

  it("has usageUnit of traces", () => {
    expect(ENTERPRISE_TEMPLATE.usageUnit).toBe("traces");
  });
});

describe("GROWTH_TEMPLATE", () => {
  describe("when inspecting plan identity", () => {
    it("has type GROWTH", () => {
      expect(GROWTH_TEMPLATE.type).toBe("GROWTH");
    });

    it("has name Growth", () => {
      expect(GROWTH_TEMPLATE.name).toBe("Growth");
    });
  });

  describe("when inspecting member limits", () => {
    it("does not preset maxMembers", () => {
      expect(GROWTH_TEMPLATE).not.toHaveProperty("maxMembers");
    });

    it("has maxMembersLite of DEFAULT_LIMIT", () => {
      expect(GROWTH_TEMPLATE.maxMembersLite).toBe(DEFAULT_LIMIT);
    });
  });

  describe("when inspecting feature limits", () => {
    it("has maxMessagesPerMonth of DEFAULT_LIMIT", () => {
      expect(GROWTH_TEMPLATE.maxMessagesPerMonth).toBe(DEFAULT_LIMIT);
    });

    it("has canPublish true", () => {
      expect(GROWTH_TEMPLATE.canPublish).toBe(true);
    });

    it("has usageUnit of events", () => {
      expect(GROWTH_TEMPLATE.usageUnit).toBe("events");
    });
  });
});

describe("getPlanTemplate", () => {
  describe("when called with a known plan type", () => {
    it("returns GROWTH template for GROWTH type", () => {
      const template = getPlanTemplate("GROWTH");

      expect(template).toEqual(GROWTH_TEMPLATE);
    });

    it("returns PRO template for PRO type", () => {
      const template = getPlanTemplate("PRO");

      expect(template).toEqual(PRO_TEMPLATE);
    });

    it("returns ENTERPRISE template for ENTERPRISE type", () => {
      const template = getPlanTemplate("ENTERPRISE");

      expect(template).toEqual(ENTERPRISE_TEMPLATE);
    });
  });

  describe("when called with an unknown plan type", () => {
    it("returns null for CUSTOM type", () => {
      const template = getPlanTemplate("CUSTOM");

      expect(template).toBeNull();
    });

    it("returns null for unknown plan type", () => {
      const template = getPlanTemplate("UNKNOWN");

      expect(template).toBeNull();
    });
  });
});
