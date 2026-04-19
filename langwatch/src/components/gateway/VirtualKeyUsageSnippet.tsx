import { Box, HStack, Link, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { RenderCode } from "~/components/code/RenderCode";

const HOSTED_GATEWAY_URL = "https://gateway.langwatch.ai/v1";
const LOCAL_GATEWAY_URL = "http://localhost:5563/v1";

function resolveGatewayBaseUrl(override?: string): string {
  if (override) return override;
  if (typeof window === "undefined") return HOSTED_GATEWAY_URL;
  // Local dev: gateway runs on :5563 alongside the app on :5560. Docker-
  // Compose + helm ingress use the same port. Any other hostname assumes
  // the hosted SaaS URL — self-hosters can override via the prop.
  if (window.location.hostname === "localhost") return LOCAL_GATEWAY_URL;
  return HOSTED_GATEWAY_URL;
}

export type VirtualKeyUsageSnippetProps = {
  /**
   * The VK secret to embed in the curl snippet. When omitted the
   * snippets fall back to the `$LANGWATCH_VK_SECRET` env-var pattern
   * — which is what you want on detail pages and from the 3-dots
   * menu, where the raw secret is no longer retrievable.
   */
  secret?: string;
  /**
   * Base URL of the AI Gateway. Defaults to the hosted SaaS URL; pass
   * your self-hosted ingress for on-prem deployments.
   */
  gatewayBaseUrl?: string;
  /** Heading shown above the language selector. */
  title?: string;
};

type Language = "python" | "typescript" | "bash";

/**
 * Copy-paste integration snippets for a LangWatch virtual key.
 *
 * Renders Python / TypeScript / cURL examples that drop into the
 * OpenAI SDK baseURL override pattern — the one-line "swap the
 * endpoint, keep your existing code" story from the docs. Used in
 * the post-create secret-reveal dialog + the VK detail page so the
 * copy-secret → first-request path has no dead ends.
 */
export function VirtualKeyUsageSnippet({
  secret,
  gatewayBaseUrl,
  title = "Usage example",
}: VirtualKeyUsageSnippetProps) {
  const [language, setLanguage] = useState<Language>("python");
  const credential = secret ?? "$LANGWATCH_VK_SECRET";
  const resolvedBaseUrl = resolveGatewayBaseUrl(gatewayBaseUrl);

  const curlSnippet = `curl ${resolvedBaseUrl}/chat/completions \\
  -H "Authorization: Bearer ${credential}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-5-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

  const pythonSnippet = `from openai import OpenAI

client = OpenAI(
    base_url="${resolvedBaseUrl}",
    api_key="${credential}",
)

response = client.chat.completions.create(
    model="openai/gpt-5-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`;

  const typescriptSnippet = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${resolvedBaseUrl}",
  apiKey: "${credential}",
});

const response = await client.chat.completions.create({
  model: "openai/gpt-5-mini",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`;

  const code =
    language === "python"
      ? pythonSnippet
      : language === "typescript"
        ? typescriptSnippet
        : curlSnippet;
  const renderLanguage =
    language === "bash" ? "bash" : language === "typescript" ? "typescript" : "python";

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between" align="center">
        <Text fontWeight="medium">{title}</Text>
        <NativeSelect.Root size="sm" width="160px">
          <NativeSelect.Field
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            data-testid="vk-usage-language-select"
          >
            <option value="python">Python</option>
            <option value="typescript">TypeScript</option>
            <option value="bash">cURL</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        Works with any OpenAI-compatible SDK or coding assistant (Claude
        Code, Codex, Cursor, Aider).{" "}
        <Link
          href="https://langwatch.ai/docs/ai-gateway/quickstart"
          color="orange.600"
          target="_blank"
          rel="noreferrer"
        >
          Read more →
        </Link>
      </Text>
      <Box borderRadius="md" overflow="hidden" width="full" fontSize="xs">
        <RenderCode
          code={code}
          language={renderLanguage}
          style={{ padding: "10px", width: "100%", fontSize: "12px" }}
        />
      </Box>
      {!secret && (
        <Text fontSize="xs" color="fg.muted">
          Set <code>LANGWATCH_VK_SECRET</code> to the VK secret from the
          create-or-rotate flow. The raw secret is shown once and not
          retrievable afterwards.
        </Text>
      )}
    </VStack>
  );
}
