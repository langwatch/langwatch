/**
 * Returns a human-readable description of the scenario schema,
 * including field descriptions, authoring guidance, and examples.
 */
export function formatScenarioSchema(): string {
  const lines: string[] = [];

  lines.push("# Scenario Schema\n");

  lines.push("## Fields\n");
  lines.push(
    '- **name** (required): A short, descriptive name (e.g., "billing dispute resolution", "password reset with 2FA unavailable")',
  );
  lines.push(
    "- **situation** (required): The context that guides the user simulator — who the user is, what they want, and any constraints (see Writing a Good Situation below)",
  );
  lines.push(
    "- **criteria** (array of strings): Pass/fail conditions a judge evaluates the agent against (see Writing Good Criteria below)",
  );
  lines.push(
    '- **labels** (array of strings): Tags for organizing scenarios (e.g., "auth", "happy-path", "edge-case")',
  );

  lines.push("\n## Writing a Good Situation\n");
  lines.push(
    "The situation drives the user simulator. Include these elements:",
  );
  lines.push("- **Persona**: Who is the user? (e.g., a stressed small business owner, a confused teenager)");
  lines.push("- **Emotional state**: How are they feeling? (e.g., frustrated, anxious, impatient)");
  lines.push("- **Background/Context**: What happened before this conversation?");
  lines.push("- **Intent**: What do they want to accomplish?");
  lines.push("- **Constraints**: What limitations do they have? (e.g., no phone for 2FA, unfamiliar with technical terms)");
  lines.push("\nExample:");
  lines.push("```");
  lines.push("User is a small business owner stressed about tax deadline.");
  lines.push("They need help categorizing expenses but aren't familiar with");
  lines.push("accounting terms. They appreciate patient explanations and examples.");
  lines.push("They have a spreadsheet of transactions but aren't sure which");
  lines.push("categories apply to their consulting business.");
  lines.push("```");

  lines.push("\n## Writing Good Criteria\n");
  lines.push("Criteria are what the judge uses to pass or fail the agent. Each criterion should be:");
  lines.push("- **Specific and testable** — not vague like \"responds helpfully\"");
  lines.push("- **Behavioral** — describes what the agent should *do*, not how it works internally");
  lines.push("- **Independent** — each criterion checks one thing");
  lines.push("\nGood criteria patterns:");
  lines.push("- **Information gathering**: \"Agent asks for the user's account number before proceeding\"");
  lines.push("- **Safety/guardrails**: \"Agent does not reveal internal system details or error stack traces\"");
  lines.push("- **Clarification**: \"Agent asks clarifying questions before taking irreversible action\"");
  lines.push("- **Tone**: \"Agent maintains a professional and empathetic tone throughout\"");
  lines.push("- **Completeness**: \"Agent confirms the user understands the solution before ending\"");
  lines.push("- **Domain-specific**: \"Agent recommends releasing a wild frog rather than keeping it as a pet\"");
  lines.push("\nAvoid vague criteria like:");
  lines.push('- "Responds correctly" — correct how?');
  lines.push('- "Is helpful" — helpful in what way?');
  lines.push('- "Works well" — not testable');

  lines.push("\n## Target Types\n");
  lines.push("Scenarios can target different execution backends:");
  lines.push("- **prompt**: Test a prompt template with variable substitution");
  lines.push("- **http**: Test an HTTP endpoint (e.g., a deployed agent API)");
  lines.push("- **code**: Test a code function directly");

  lines.push("\n## Tips\n");
  lines.push("- Start simple, then layer complexity (add constraints, edge cases)");
  lines.push("- Test edge cases: user changes their mind, gives ambiguous input, makes mistakes");
  lines.push("- Use `fetch_scenario_docs` for the full authoring guide and advanced patterns");

  return lines.join("\n");
}
