import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";

/**
 * ADR-063: this package is database-free and transport-agnostic by
 * construction. Repository implementations, Next.js, and React live in the
 * app and arrive by injection — a dependency on any of them here collapses
 * the package boundary the ADR draws.
 */
const FORBIDDEN_DEPENDENCIES = [
  "@prisma/client",
  "prisma",
  "next",
  "react",
  "react-dom",
];

describe("automations-server package boundary", () => {
  const allDependencyNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ];

  it.each(FORBIDDEN_DEPENDENCIES)(
    "keeps %s out of every dependency field",
    (forbidden) => {
      expect(allDependencyNames).not.toContain(forbidden);
    },
  );

  it("depends on the domain package, not the other way around", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).toContain(
      "@langwatch/automations",
    );
  });
});
