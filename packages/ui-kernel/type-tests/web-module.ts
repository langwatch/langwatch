import { expectTypeOf } from "vitest";

import { defineWebModule } from "../src/web-module.ts";

const withCapability = defineWebModule("capability-slot-proof").withCapabilities({
  double: (value: string) => value.length * 2,
  kind: "scope",
});

// The literal function signature survives the slot — not widened to `unknown`.
expectTypeOf<typeof withCapability.installation.capabilities.double>().toEqualTypeOf<
  (value: string) => number
>();

// @ts-expect-error a declared capability keeps its own parameter type, not `any`
withCapability.installation.capabilities.double(1);

// `const` is load-bearing here: without it this string literal widens to
// `string` and this assertion fails — proving the type parameter is doing
// real work, not merely decorating the signature.
expectTypeOf<typeof withCapability.installation.capabilities.kind>().toEqualTypeOf<"scope">();

const withoutCapabilities = defineWebModule("no-capabilities-proof");
expectTypeOf<typeof withoutCapabilities.installation.capabilities>().toEqualTypeOf<
  Record<never, never>
>();

// @ts-expect-error an undeclared capability key does not exist on the slot
void withoutCapabilities.installation.capabilities.missing;
