import { describe, expect, it } from "vitest";

import { templatesHooksOrigin } from "../hooks-url.ts";

describe("templatesHooksOrigin", () => {
  it.each([
    "https://{{ params.host }}/hooks",
    "https://hooks.{{ params.domain }}/hooks",
    "{{ params.scheme }}://support.example/hooks",
    "{{ params.base }}/hooks",
    "https://user:{{ params.password }}@support.example/hooks",
    "https://support.example:{{ params.port }}/hooks",
    "https://support.example%7Bparams%7D/hooks",
  ])("flags a template before the path in %s", (hooksUrl) => {
    expect(templatesHooksOrigin(hooksUrl)).toBe(true);
  });

  it.each([
    "https://support.example/hooks/{{ params.id }}",
    "https://support.example/hooks?tenant={{ params.tenant }}",
    "https://support.example/hooks",
    "",
    undefined,
  ])("allows a template in the path or query of %s", (hooksUrl) => {
    expect(templatesHooksOrigin(hooksUrl)).toBe(false);
  });
});
