// Merges the JSON diagnostics of oxlint processes that linted the same files with
// disjoint rule sets. Each process reports every directive its own rules did not
// use, so a directive is unused only where every process says so. ADR-150,
// amendment 2026-10-05.
const DIRECTIVE = /^Unused (?:eslint|oxlint)-[a-z-]+ directive \((?<detail>.*)\)\.$/;
const FROM_RULE = /^no problems were reported from /;

function spanOf(diagnostic) {
  return diagnostic.labels?.[0]?.span ?? { offset: 0, length: 0 };
}

function keyOf(diagnostic) {
  return `${diagnostic.filename}\0${spanOf(diagnostic).offset}\0${diagnostic.message}`;
}

/** A whole-directive report whose comment holds the per-rule report's span. */
function covers({ whole, rule }) {
  const outer = spanOf(whole);
  const inner = spanOf(rule).offset;
  const sameFile = whole.filename === rule.filename;

  return sameFile && outer.offset <= inner && inner < outer.offset + outer.length;
}

function isDirective(diagnostic) {
  return diagnostic.code === undefined && DIRECTIVE.test(diagnostic.message);
}

function isPerRule(diagnostic) {
  return FROM_RULE.test(DIRECTIVE.exec(diagnostic.message).groups.detail);
}

/**
 * Every process's findings, plus the unused-directive reports all processes agree on.
 * A per-rule report ("from <rule>") also holds where another process found the whole
 * directive unused, since that process used none of the directive's rules.
 */
export function mergeDiagnostics({ reports }) {
  const directives = reports.map((report) => report.filter(isDirective));
  const findings = reports.flatMap((report) => report.filter((d) => !isDirective(d)));
  const agreed = (diagnostic) =>
    directives.every((report) =>
      report.some(
        (other) =>
          keyOf(other) === keyOf(diagnostic) ||
          (isPerRule(diagnostic) &&
            !isPerRule(other) &&
            covers({ whole: other, rule: diagnostic })),
      ),
    );
  const unique = new Map(directives.flat().map((d) => [keyOf(d), d]));

  return [...findings, ...[...unique.values()].filter(agreed)];
}
