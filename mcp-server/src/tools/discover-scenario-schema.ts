/**
 * Returns a human-readable description of the scenario schema,
 * including field descriptions, target types, and examples.
 */
export function formatScenarioSchema(): string {
  const lines: string[] = [];

  lines.push("# Scenario Schema\n");

  lines.push("## Fields\n");
  lines.push(
    "- **name** (required): A short, descriptive name for the scenario (e.g., \"Login Flow Happy Path\")",
  );
  lines.push(
    "- **situation** (required): The context or setup that describes what the user/agent is doing",
  );
  lines.push(
    "- **criteria** (array of strings): Pass/fail conditions the agent's response must satisfy",
  );
  lines.push(
    "- **labels** (array of strings): Tags for organizing and filtering scenarios",
  );

  lines.push("\n## Target Types\n");
  lines.push(
    "Scenarios can target different execution backends:",
  );
  lines.push("- **prompt**: Test a prompt template with variable substitution");
  lines.push("- **http**: Test an HTTP endpoint (e.g., a deployed agent API)");
  lines.push("- **code**: Test a code function directly");

  lines.push("\n## Example Criteria\n");
  lines.push("Good criteria are specific and testable:");
  lines.push('- "Responds with a welcome message containing the user name"');
  lines.push('- "Returns a JSON object with a `status` field set to `success`"');
  lines.push('- "Does not reveal internal system details or error stack traces"');
  lines.push('- "Responds in under 3 seconds"');

  return lines.join("\n");
}
