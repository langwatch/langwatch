// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";

import { awsPrincipalKey, awsPrincipalMatch } from "../aws-principal.rules.ts";

const ROLE = "arn:aws:iam::123456789012:role/traced-agent";
const SESSION = "arn:aws:sts::123456789012:assumed-role/traced-agent/claims-session";

describe("awsPrincipalKey", () => {
  it("gives an IAM role and its assumed-role session the same key", () => {
    expect(awsPrincipalKey(SESSION)).toBe(awsPrincipalKey(ROLE));
  });

  it("ignores the role path", () => {
    expect(awsPrincipalKey("arn:aws:iam::123456789012:role/agents/traced-agent")).toBe(
      awsPrincipalKey(ROLE),
    );
  });

  it("keeps roles of other accounts and partitions apart", () => {
    expect(awsPrincipalKey("arn:aws:iam::210987654321:role/traced-agent")).not.toBe(
      awsPrincipalKey(ROLE),
    );
    expect(awsPrincipalKey("arn:aws-cn:iam::123456789012:role/traced-agent")).not.toBe(
      awsPrincipalKey(ROLE),
    );
  });

  it("keeps a user ARN as its own key", () => {
    const user = "arn:aws:iam::123456789012:user/jane";
    expect(awsPrincipalKey(user)).toBe(user);
  });
});

describe("awsPrincipalMatch", () => {
  const SESSIONS = "arn:aws:sts::123456789012:assumed-role/traced-agent/";
  const IAM_ROLES = "arn:aws:iam::123456789012:role/";

  it("adds the IAM role form and every session of the role for an assumed-role session", () => {
    expect(awsPrincipalMatch(SESSION)).toEqual({
      values: [SESSION, ROLE],
      prefixes: [SESSIONS, IAM_ROLES],
    });
  });

  it("matches an IAM role ARN exactly and any of its sessions by prefix", () => {
    expect(awsPrincipalMatch(ROLE)).toEqual({ values: [ROLE], prefixes: [SESSIONS, IAM_ROLES] });
  });

  it("reaches an IAM role ARN with a path, which then shares the caller's key", () => {
    const pathed = "arn:aws:iam::123456789012:role/agents/claims/traced-agent";
    const { prefixes } = awsPrincipalMatch(SESSION);
    expect(prefixes.some((prefix) => pathed.startsWith(prefix))).toBe(true);
    expect(awsPrincipalKey(pathed)).toBe(awsPrincipalKey(SESSION));
  });

  it("matches a user ARN only exactly", () => {
    const user = "arn:aws:iam::123456789012:user/alice";
    expect(awsPrincipalMatch(user)).toEqual({ values: [user], prefixes: [] });
  });
});
