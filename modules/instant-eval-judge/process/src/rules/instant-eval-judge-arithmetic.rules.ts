/**
 * Whether a question asks for arithmetic, by the rule the routes were measured with. It fires on
 * any digit, so it flags many everyday checks; a caller's own flag is preferred where the table
 * allows one. @see modules/instant-eval-judge/specs/instant-eval-judge-router.feature
 */

const ARITHMETIC_PATTERN = new RegExp(
  [
    String.raw`\b(how many|count(s|ed|ing)?|total(s|led)?|sum|average|mean|percent(age)?`,
    String.raw`|more than \d|less than \d|at least \d|at most \d|number of|amount|price|cost`,
    String.raw`|refund|fee|charge|discount|balance|date|deadline|days?|weeks?|months?|hours?`,
    String.raw`|minutes?|before|after|within|late|early|calculat\w*|correct (figure|total|amount)`,
    String.raw`|exceed\w*)\b|[%€$£]|\d`,
  ].join(""),
  "i",
);

export function isArithmeticQuestion(instructions: string): boolean {
  return ARITHMETIC_PATTERN.test(instructions);
}
