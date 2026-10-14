/**
 * The callout at the top of Integrations for people looking for the LangWatch MCP, which is set
 * up in their AI client rather than here: the docs, and Langy to walk them through it.
 * Spec: modules/integration/specs/langwatch-mcp-banner.feature
 */

import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Link } from "@langwatch/design-system/primitives";
import { Plug } from "lucide-react";

import { useGithubHost } from "../../model/github-host.ts";

export const LANGWATCH_MCP_DOCS_URL = "https://langwatch.ai/docs/integration/mcp";
export const LANGWATCH_MCP_LANGY_QUESTION = "Help me connect the LangWatch MCP";

export function LangwatchMcpBanner() {
  const host = useGithubHost();
  const askLangy = host.canAskLangy() ? () => host.askLangy(LANGWATCH_MCP_LANGY_QUESTION) : null;

  return (
    <Banner
      data-testid="langwatch-mcp-banner"
      status="info"
      icon={<Plug size={16} />}
      title="Looking to add the LangWatch MCP?"
      action={askLangy ? <BannerAction onClick={askLangy}>Ask Langy</BannerAction> : null}
    >
      Use LangWatch from Claude, Cursor, ChatGPT and more.{" "}
      <Link href={LANGWATCH_MCP_DOCS_URL} target="_blank" rel="noopener noreferrer">
        See how in the docs
      </Link>
    </Banner>
  );
}
