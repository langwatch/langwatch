import {
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  IconButton,
  Link,
  Tabs,
  Text,
  useTabs,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "~/components/ui/color-mode";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { resolveSnippetGatewayBaseUrl } from "./gatewaySnippetUrl";

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
  /**
   * Model string embedded in every snippet's chat-completions call, in
   * resolver-safe `vendor/model` form (e.g. `custom/Qwen2.5-0.5B-Instruct`).
   * Callers thread the key's first eligible provider so the example names a
   * model the key can actually serve. Falls back to `gpt-5-mini` only as a
   * placeholder when the caller has no provider context.
   */
  model?: string;
};

type Language = "python" | "typescript" | "go" | "bash";

interface TabItem {
  key: Language;
  title: string;
  code: string;
  language: string;
  highlightLines: number[];
}

/**
 * Copy-paste integration snippets for a LangWatch virtual key.
 *
 * Renders Python / TypeScript / Go / cURL examples that drop into the
 * OpenAI SDK baseURL override pattern — the one-line "swap the
 * endpoint, keep your existing code" story from the docs. Used in
 * the post-create secret-reveal dialog + the VK detail page so the
 * copy-secret → first-request path has no dead ends.
 */
// `gpt-5-mini` is only the fallback placeholder for callers that pass no
// model. The real default is threaded in by the create / reveal / detail
// surfaces as the key's first eligible provider in `vendor/model` form. The
// gateway resolver strips the `vendor/` prefix before dispatch (it only
// selects the provider, then forwards the bare model), so the prefixed form
// is always safe, including for single-provider keys.
export function VirtualKeyUsageSnippet({
  secret,
  gatewayBaseUrl,
  title = "Usage example",
  model = "gpt-5-mini",
}: VirtualKeyUsageSnippetProps) {
  const { colorMode } = useColorMode();
  const publicEnv = usePublicEnv();
  const credential = secret ?? "$LANGWATCH_VK_SECRET";
  const resolvedBaseUrl = resolveSnippetGatewayBaseUrl(
    gatewayBaseUrl,
    publicEnv.data?.GATEWAY_BASE_URL,
  );
  const showRetrievalHint = !secret;

  const tabItems: TabItem[] = useMemo(() => {
    const reminder =
      "The full secret is shown only once during create or rotate. If you do not have it saved, rotate to mint a fresh one.";
    const hashHint = showRetrievalHint
      ? `# ${reminder}\n# Set LANGWATCH_VK_SECRET in your shell, or paste the secret in place of $LANGWATCH_VK_SECRET below.\n\n`
      : "";
    const slashHint = showRetrievalHint
      ? `// ${reminder}\n// Set LANGWATCH_VK_SECRET in your shell, or paste the secret in place of $LANGWATCH_VK_SECRET below.\n\n`
      : "";
    const pythonHighlightShift = showRetrievalHint ? 3 : 0;
    const tsHighlightShift = showRetrievalHint ? 3 : 0;
    const goHighlightShift = showRetrievalHint ? 3 : 0;
    const curlHighlightShift = showRetrievalHint ? 3 : 0;
    const pythonSnippet = `${hashHint}from openai import OpenAI

client = OpenAI(
    base_url="${resolvedBaseUrl}",
    api_key="${credential}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`;

    const typescriptSnippet = `${slashHint}import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${resolvedBaseUrl}",
  apiKey: "${credential}",
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`;

    const goSnippet = `${slashHint}package main

import (
\t"context"
\t"fmt"

\topenai "github.com/openai/openai-go"
\t"github.com/openai/openai-go/option"
)

func main() {
\tclient := openai.NewClient(
\t\toption.WithBaseURL("${resolvedBaseUrl}"),
\t\toption.WithAPIKey("${credential}"),
\t)

\tresponse, _ := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
\t\tModel: "${model}",
\t\tMessages: []openai.ChatCompletionMessageParamUnion{
\t\t\topenai.UserMessage("Hello"),
\t\t},
\t})
\tfmt.Println(response.Choices[0].Message.Content)
}`;

    const curlSnippet = `${hashHint}curl ${resolvedBaseUrl}/chat/completions \\
  -H "Authorization: Bearer ${credential}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`;

    return [
      { key: "python", title: "Python", code: pythonSnippet, language: "python", highlightLines: [4 + pythonHighlightShift, 5 + pythonHighlightShift] },
      { key: "typescript", title: "TypeScript", code: typescriptSnippet, language: "typescript", highlightLines: [4 + tsHighlightShift, 5 + tsHighlightShift] },
      { key: "go", title: "Go", code: goSnippet, language: "go", highlightLines: [13 + goHighlightShift, 14 + goHighlightShift] },
      { key: "bash", title: "cURL", code: curlSnippet, language: "bash", highlightLines: [1 + curlHighlightShift, 2 + curlHighlightShift] },
    ];
  }, [resolvedBaseUrl, credential, showRetrievalHint, model]);

  const tabs = useTabs({ defaultValue: "python" });
  const activeTab = tabItems.find((t) => t.key === tabs.value) ?? tabItems[0]!;
  const otherTabs = tabItems.filter((t) => t.key !== tabs.value);

  const shikiAdapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({
          langs: ["typescript", "python", "go", "bash"],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);

  return (
    <VStack align="stretch" gap={2}>
      <Text fontWeight="medium">{title}</Text>
      <Text textStyle="xs" color="fg.muted">
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
      <Tabs.RootProvider value={tabs} size="sm" variant="line">
        <CodeBlock.AdapterProvider value={shikiAdapter}>
          <ClientOnly>
            {() => (
              <CodeBlock.Root
                code={activeTab.code}
                language={activeTab.language}
                size="sm"
                meta={{ highlightLines: activeTab.highlightLines, colorScheme: colorMode }}
                transition="all 0.3s ease"
                bg="bg.panel/60"
                borderRadius="xl"
                border="1px solid"
                borderColor="border"
                backdropFilter="blur(20px) saturate(1.3)"
                boxShadow="0 2px 16px rgba(0,0,0,0.04)"
                overflow="hidden"
              >
                <CodeBlock.Header borderBottomWidth="1px" borderColor="border">
                  <Tabs.List w="full" border="0" ms="-1">
                    {tabItems.map((t) => (
                      <Tabs.Trigger
                        colorPalette="teal"
                        key={t.key}
                        value={t.key}
                        textStyle="xs"
                        data-testid={`vk-usage-tab-${t.key}`}
                      >
                        {t.title}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                  <CodeBlock.CopyTrigger asChild>
                    <IconButton variant="ghost" size="2xs" mr={"-4px"}>
                      <CodeBlock.CopyIndicator />
                    </IconButton>
                  </CodeBlock.CopyTrigger>
                </CodeBlock.Header>
                <CodeBlock.Content
                  transition="background-color 0.3s ease, color 0.3s ease"
                  css={{
                    "& pre, & code": {
                      transition: "background-color 0.3s ease, color 0.3s ease",
                    },
                  }}
                  overflow="scroll"
                >
                  {otherTabs.map((t) => (
                    <Tabs.Content key={t.key} value={t.key} />
                  ))}
                  <Tabs.Content pt="1" value={activeTab.key}>
                    <CodeBlock.Code>
                      <CodeBlock.CodeText />
                    </CodeBlock.Code>
                  </Tabs.Content>
                </CodeBlock.Content>
              </CodeBlock.Root>
            )}
          </ClientOnly>
        </CodeBlock.AdapterProvider>
      </Tabs.RootProvider>
    </VStack>
  );
}
