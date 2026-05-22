// Smoke-test v3 — DO NOT MERGE. Non-exhaustive switch (typescript.md).

type Color = "red" | "green" | "blue";

export function colorName(c: Color): string {
  switch (c) {
    case "red":
      return "Red";
    case "green":
      return "Green";
    // Missing "blue" + missing never check in default — VIOLATION.
  }
  return "unknown";
}

// Named-params violation: 3+ positional same-type args (typescript.md).
export function runFooBar(scenarioId: string, target: string, setId: string): string {
  return `${scenarioId}/${target}/${setId}`;
}
