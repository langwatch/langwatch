import type { InstallMatrix } from "./registry";

interface LLMIntegrationPromptProps {
  frameworkLabel: string;
  install?: InstallMatrix;
  docs: { internal?: string; external?: string };
  code: string;
  codeLanguage: string;
  instrumentationCode?: string;
  runCommand?: string;
}

export function generateLLMIntegrationPrompt(
  props: LLMIntegrationPromptProps,
): string {
  const { frameworkLabel, install, docs, code, codeLanguage, instrumentationCode, runCommand } = props;

  let prompt = `# Integrate LangWatch with ${frameworkLabel}\n\n`;

  prompt += `## Overview\n`;
  prompt += `LangWatch provides comprehensive observability and monitoring for LLM applications. This guide shows you how to integrate ${frameworkLabel} with LangWatch to enable automatic tracing, logging, and performance monitoring.\n\n`;

  // Installation section
  if (install) {
    prompt += `## Installation\n`;
    prompt += `Install the required packages using your preferred package manager:\n\n`;

    if (install.js) {
      if (install.js.npm) prompt += `\`\`\`bash\n${install.js.npm}\n\`\`\`\n\n`;
      if (install.js.pnpm)
        prompt += `\`\`\`bash\n${install.js.pnpm}\n\`\`\`\n\n`;
      if (install.js.yarn)
        prompt += `\`\`\`bash\n${install.js.yarn}\n\`\`\`\n\n`;
      if (install.js.bun) prompt += `\`\`\`bash\n${install.js.bun}\n\`\`\`\n\n`;
    }

    if (install.python) {
      if (install.python.pip)
        prompt += `\`\`\`bash\n${install.python.pip}\n\`\`\`\n\n`;
      if (install.python.uv)
        prompt += `\`\`\`bash\n${install.python.uv}\n\`\`\`\n\n`;
    }

    if (install.go) {
      if (install.go["go get"])
        prompt += `\`\`\`bash\n${install.go["go get"]}\n\`\`\`\n\n`;
    }
  }

  // Instrumentation file section (if applicable)
  if (instrumentationCode) {
    prompt += `## Instrumentation Setup\n`;
    prompt += `Create an \`instrumentation.ts\` file that initializes observability before your application starts:\n\n`;
    prompt += `\`\`\`typescript\n${instrumentationCode}\n\`\`\`\n\n`;
    if (runCommand) {
      prompt += `Run your application with the following command:\n\n`;
      prompt += `\`\`\`bash\n${runCommand}\n\`\`\`\n\n`;
    } else {
      prompt += `Run your application with the \`--import\` flag to ensure observability is initialized before any other modules load:\n\n`;
      prompt += `\`\`\`bash\nnode --import ./instrumentation.ts app.ts\n\`\`\`\n\n`;
    }
  }

  // Integration code section
  prompt += `## Integration Code\n`;
  prompt += `Add the following code to your application:\n\n`;
  prompt += `\`\`\`${codeLanguage}\n${code}\n\`\`\`\n\n`;

  // Documentation section
  prompt += `## Documentation\n`;
  if (docs.internal) {
    prompt += `- **LangWatch Integration Guide**: https://docs.langwatch.ai${docs.internal}\n`;
  } else if (docs.external) {
    prompt += `- **${frameworkLabel} Documentation**: ${docs.external}\n`;
  }
  prompt += `\n`;

  // Key implementation notes
  prompt += `## Key Implementation Notes\n`;
  prompt += `- This integration enables automatic tracing of all LLM calls\n`;
  prompt += `- Traces and metrics will be sent to your LangWatch dashboard\n`;
  prompt += `- Ensure your API key/project configuration is set correctly\n`;
  prompt += `- Review the documentation for advanced configuration options and best practices\n`;

  return prompt;
}
