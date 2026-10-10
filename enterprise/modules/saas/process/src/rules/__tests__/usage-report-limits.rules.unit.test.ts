// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { senderAddressesOf } from "../usage-report-limits.rules.ts";

describe("senderAddressesOf", () => {
  it("takes the first address a forwarding chain names", () => {
    expect(senderAddressesOf({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })).toEqual([
      "203.0.113.7",
    ]);
  });

  it("prefers the most specific proxy header", () => {
    expect(
      senderAddressesOf({ "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "203.0.113.7" }),
    ).toEqual(["198.51.100.2"]);
  });

  it("unwraps an IPv4-mapped IPv6 address", () => {
    expect(senderAddressesOf({ "x-real-ip": "::ffff:203.0.113.7" })).toEqual(["203.0.113.7"]);
  });

  /** @scenario "A sender's IPv6 address is limited like any other" */
  it("names a compressed IPv6 address, in one spelling whatever its case", () => {
    expect(senderAddressesOf({ "cf-connecting-ip": "2001:DB8::1" })).toEqual(["2001:db8::1"]);
    expect(senderAddressesOf({ "x-forwarded-for": "::1, 10.0.0.1" })).toEqual(["::1"]);
    expect(senderAddressesOf({ "x-real-ip": "2001:db8:0:0:0:0:0:1" })).toEqual([
      "2001:db8:0:0:0:0:0:1",
    ]);
  });

  it("keeps an IPv6 address that only begins like a mapped one", () => {
    expect(senderAddressesOf({ "x-real-ip": "::ffff:abcd" })).toEqual(["::ffff:abcd"]);
  });

  it("names no address where no header carries a well-formed one", () => {
    expect(senderAddressesOf({ "x-forwarded-for": "not-an-address" })).toEqual([]);
    expect(senderAddressesOf({ "x-forwarded-for": "2001:db8:::1" })).toEqual([]);
    expect(senderAddressesOf({ "x-forwarded-for": "999.1.1.1" })).toEqual([]);
    expect(senderAddressesOf({})).toEqual([]);
  });
});
