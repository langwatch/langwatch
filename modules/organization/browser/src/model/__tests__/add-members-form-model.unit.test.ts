import { describe, expect, it } from "vitest";

import { inviteEmailChips, inviteEmailsRaw, isInviteEmail } from "../add-members-form-model.ts";

describe("inviteEmailChips", () => {
  it("keeps the address still being typed out of the chips", () => {
    expect(inviteEmailChips("a@x.com, b@y")).toEqual({ chips: ["a@x.com"], draft: "b@y" });
  });

  it("turns every address into a chip once a separator follows it", () => {
    expect(inviteEmailChips("a@x.com b@y.com;")).toEqual({
      chips: ["a@x.com", "b@y.com"],
      draft: "",
    });
  });

  it("reads an empty box as nothing", () => {
    expect(inviteEmailChips("")).toEqual({ chips: [], draft: "" });
  });
});

describe("inviteEmailsRaw", () => {
  it("round-trips chips and the draft through the raw text", () => {
    const raw = inviteEmailsRaw({ chips: ["a@x.com"], draft: "b@y" });
    expect(inviteEmailChips(raw)).toEqual({ chips: ["a@x.com"], draft: "b@y" });
  });

  it("keeps finished chips finished when nothing is being typed", () => {
    const raw = inviteEmailsRaw({ chips: ["a@x.com"], draft: "" });
    expect(inviteEmailChips(raw)).toEqual({ chips: ["a@x.com"], draft: "" });
  });
});

describe("isInviteEmail", () => {
  it("flags an address without a domain", () => {
    expect(isInviteEmail("bob@")).toBe(false);
    expect(isInviteEmail("bob@example.com")).toBe(true);
  });
});
