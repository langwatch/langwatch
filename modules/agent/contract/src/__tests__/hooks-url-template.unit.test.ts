import { describe, expect, it } from "vitest";

import { readHooksOrigin, templatesHooksOrigin } from "../hooks-url.ts";

describe("templatesHooksOrigin", () => {
  it.each([
    "https://{{ params.host }}/hooks",
    "https://hooks.{{ params.domain }}/hooks",
    "{{ params.scheme }}://support.example/hooks",
    "{{ params.base }}/hooks",
    "https://user:{{ params.password }}@support.example/hooks",
    "https://support.example:{{ params.port }}/hooks",
    "https://support.example%7Bparams%7D/hooks",
    "https://support.example%7bparams%7d/hooks",
    "https://support.example}/hooks",
    "https://support.example@{{ params.host }}/hooks",
    "https://support.example{% if params.x %}.evil.test{% endif %}/hooks",
  ])("flags a template before the path in %s", (hooksUrl) => {
    expect(templatesHooksOrigin(hooksUrl)).toBe(true);
  });

  // The WHATWG parser skips extra slashes and reads "\" as "/" for http(s): each of these
  // renders to the host the template chooses.
  it.each([
    "https:///{{ h }}/hook",
    "https:/{{ h }}/hook",
    "https:////{{p.h}}",
    "https:/\\{{p.h}}",
    "https:\\/{{p.h}}",
    "https:/\\{{x}}",
    "https:{{p.h}}/hook",
    "HTTPS://{{p.h}}/hook",
    "HTTPS:///{{p.h}}/hook",
    " https:///{{p.h}}/hook",
    "\t\nhttps://{{p.h}}/hook",
    "https:\t//{{p.h}}/hook",
    "ht\ntps:///{{p.h}}/hook",
    "\u0000https:///{{p.h}}/hook",
  ])("flags %j, which the URL parser reads with the template in the host", (hooksUrl) => {
    expect(templatesHooksOrigin(hooksUrl)).toBe(true);
  });

  it.each([
    "https://support.example/hooks/{{ params.id }}",
    "https://support.example/hooks?tenant={{ params.tenant }}",
    "https://support.example/hooks#{{ params.anchor }}",
    "https://support.example\\{{ params.id }}",
    "HTTPS://support.example/{{ params.id }}?q={{ params.q }}#{{ params.f }}",
    "https://support.example/hooks",
    "",
    undefined,
  ])("allows a template in the path, query or fragment of %j", (hooksUrl) => {
    expect(templatesHooksOrigin(hooksUrl)).toBe(false);
  });
});

describe("readHooksOrigin", () => {
  it.each([
    ["https://support.example/hooks", "https://support.example"],
    [
      "https://support.example:8443/hooks/{{ params.id }}?t={{ params.t }}",
      "https://support.example:8443",
    ],
    [" HTTPS://Support.Example/hooks#{{ params.f }}", "https://support.example"],
  ])("is the origin of %j whatever its templates render to", (hooksUrl, origin) => {
    expect(readHooksOrigin(hooksUrl)).toEqual({ isFixed: true, origin });
  });

  it.each([
    "https://{{ params.host }}/hooks",
    "https:///{{ h }}/hook",
    "https:/\\{{p.h}}",
    "https://{{ params.user }}@support.example/hooks",
    "https://user:{{ params.password }}@support.example/hooks",
    "{{ params.base }}/hooks",
    "not a url",
  ])("is not fixed for %j, whose origin a template chooses or which does not parse", (hooksUrl) => {
    expect(readHooksOrigin(hooksUrl)).toEqual({ isFixed: false });
  });

  it("is fixed for a static password, which no template can change", () => {
    expect(readHooksOrigin("https://user:pw@support.example/hooks")).toEqual({
      isFixed: true,
      origin: "https://support.example",
    });
  });
});
