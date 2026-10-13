import assert from "node:assert/strict";
import { test } from "node:test";

import { faultBody, routeRule, takeFault } from "./browser-route.ts";

/** @scenario "A browser lane can fault matching requests to walk a failure and its retry" */
void test("a rule with --times faults that many matches, then lets requests through", () => {
  const rule = routeRule({ pattern: "**/api/trpc/**", status: 503, times: 2 });
  assert.deepEqual(
    [takeFault({ rule }), takeFault({ rule }), takeFault({ rule })],
    [true, true, false],
  );
  assert.equal(rule.hits, 2);
});

void test("a rule without --times faults every match and defaults to 503", () => {
  const rule = routeRule({ pattern: "**/x" });
  assert.equal(rule.status, 503);
  for (let i = 0; i < 5; i++) assert.equal(takeFault({ rule }), true);
});

void test("a rule refuses a missing pattern, a non-HTTP status and a non-positive count", () => {
  assert.throws(() => routeRule({ pattern: "" }), /needs <pattern>/);
  assert.throws(() => routeRule({ pattern: "**/x", status: 700 }), /not an HTTP status/);
  assert.throws(() => routeRule({ pattern: "**/x", times: 0 }), /not a positive number/);
});

void test("a faulted request answers JSON naming the forced status", () => {
  const body = JSON.parse(faultBody({ rule: routeRule({ pattern: "**/x", status: 500 }) }));
  assert.equal(body.error.code, "haven_route_fault");
  assert.match(body.error.message, /forced 500/);
});
