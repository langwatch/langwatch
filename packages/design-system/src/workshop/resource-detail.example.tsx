import { isBrowserClick } from "@langwatch/design-system/back-link";
import { Card } from "@langwatch/design-system/card";
import { CodeTabs, type CodeTabItem } from "@langwatch/design-system/code-tabs";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { InlineCode } from "@langwatch/design-system/inline-code";
import { ListTable } from "@langwatch/design-system/list-table";
import { Money } from "@langwatch/design-system/money";
import { NoDataInfoBlock, type EmptyNext } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Box,
  Button,
  Grid,
  GridItem,
  Link,
  Text,
} from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { SkeletonCard } from "@langwatch/design-system/skeletons";
import { SummaryList, SummaryListItem } from "@langwatch/design-system/summary-list";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";

export type KeyStatus = "active" | "disabled" | "revoked";

/** One model's share of the key's last 30 days. Money is in cents so the totals always agree. */
export interface ModelUsage {
  model: string;
  requests: number;
  cents: number;
}

/** What the page shows about one virtual key. The secret itself is never part of it. */
export interface VirtualKey {
  id: string;
  name: string;
  description: string;
  status: KeyStatus;
  /** The first characters of the secret; the rest is shown once, when the key is created. */
  prefix: string;
  scopes: { scopeType: "TEAM" | "PROJECT"; scopeId: string; name: string }[];
  routingPolicy: string;
  providers: string[];
  expires: string | null;
  lastUsed: string | null;
  created: string;
  revision: number;
  usage: ModelUsage[];
}

/** Which of the page's views shows. `ready` is the key itself. */
export type DetailView = "ready" | "loading" | "failed" | "missing";

/**
 * Only the stories use this: it opens the example already in one of its states.
 * Leave it out in your application.
 */
export interface ResourceDetailStart {
  key?: Partial<VirtualKey>;
  view?: DetailView;
  confirm?: "disable" | "revoke";
}

type Language = "python" | "typescript" | "go" | "bash";

const KEYS_HREF = "/gateway/virtual-keys";
const DOCS = "https://docs.langwatch.ai/ai-gateway/quickstart";
const GATEWAY_URL = "https://gateway.langwatch.ai/v1";
const MODEL = "openai/gpt-5-mini";
const SECRET_PLACEHOLDER = "$LANGWATCH_VK_SECRET";

export const SEED_KEY: VirtualKey = {
  id: "vk_1042",
  name: "Production support key",
  description: "Lets the Support assistant call models through the gateway.",
  status: "active",
  prefix: "lw_vk_7Hq2",
  scopes: [
    { scopeType: "TEAM", scopeId: "team_support", name: "Support" },
    { scopeType: "PROJECT", scopeId: "project_support", name: "Support assistant" },
  ],
  routingPolicy: "Cheapest first, then fall back",
  providers: ["OpenAI", "Anthropic"],
  expires: "31 Dec 2026",
  lastUsed: "11 Oct 2026, 09:12 UTC",
  created: "2 Sep 2026",
  revision: 4,
  usage: [
    { model: "openai/gpt-5-mini", requests: 4812, cents: 1842 },
    { model: "anthropic/claude-sonnet-4-5", requests: 1106, cents: 3107 },
  ],
};

const REMINDER =
  "The full secret is shown only once during create or rotate. If you do not have it saved, rotate to mint a fresh one.";
const HINT = `Set LANGWATCH_VK_SECRET in your shell, or paste the secret in place of ${SECRET_PLACEHOLDER} below.`;

/** The four snippets the page offers. The secret is unavailable, so each reads a variable. */
function usageSnippets(): CodeTabItem<Language>[] {
  const hash = `# ${REMINDER}\n# ${HINT}\n\n`;
  const slash = `// ${REMINDER}\n// ${HINT}\n\n`;
  return [
    {
      value: "python",
      label: "Python",
      language: "python",
      highlightLines: [7, 8],
      testId: "vk-usage-tab-python",
      code: `${hash}from openai import OpenAI

client = OpenAI(
    base_url="${GATEWAY_URL}",
    api_key="${SECRET_PLACEHOLDER}",
)

response = client.chat.completions.create(
    model="${MODEL}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
    },
    {
      value: "typescript",
      label: "TypeScript",
      language: "typescript",
      highlightLines: [7, 8],
      testId: "vk-usage-tab-typescript",
      code: `${slash}import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${GATEWAY_URL}",
  apiKey: "${SECRET_PLACEHOLDER}",
});

const response = await client.chat.completions.create({
  model: "${MODEL}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`,
    },
    {
      value: "go",
      label: "Go",
      language: "go",
      highlightLines: [16, 17],
      testId: "vk-usage-tab-go",
      code: `${slash}package main

import (
\t"context"
\t"fmt"

\t"github.com/openai/openai-go/v3"
\t"github.com/openai/openai-go/v3/option"
)

func main() {
\tclient := openai.NewClient(
\t\toption.WithBaseURL("${GATEWAY_URL}"),
\t\toption.WithAPIKey("${SECRET_PLACEHOLDER}"),
\t)

\tresponse, _ := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
\t\tModel: "${MODEL}",
\t\tMessages: []openai.ChatCompletionMessageParamUnion{
\t\t\topenai.UserMessage("Hello"),
\t\t},
\t})
\tfmt.Println(response.Choices[0].Message.Content)
}`,
    },
    {
      value: "bash",
      label: "cURL",
      language: "bash",
      highlightLines: [4, 5],
      testId: "vk-usage-tab-bash",
      code: `${hash}curl ${GATEWAY_URL}/chat/completions \\
  -H "Authorization: Bearer ${SECRET_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${MODEL}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`,
    },
  ];
}

const SNIPPETS = usageSnippets();

/** Narrow: facts first, one column. From 62rem wide the facts sit in a narrow right column. */
const DETAIL_GRID = {
  gridTemplateColumns: "minmax(0, 1fr)",
  gridTemplateAreas: '"facts" "main"',
  "@container (min-width: 62rem)": {
    gridTemplateColumns: "minmax(0, 1fr) 380px",
    gridTemplateAreas: '"main facts"',
  },
} as const;

const STATUS_PALETTE = { active: "green", disabled: "gray", revoked: "red" } as const;

const CONFIRMS = {
  disable: {
    title: (name: string) => `Disable ${name}?`,
    description:
      "Requests are rejected with a distinct disabled error within seconds. Everything about the key is preserved; enable restores it exactly as it was.",
    confirmLabel: "Disable key",
    tone: "default",
  },
  revoke: {
    title: (name: string) => `Revoke ${name}?`,
    description:
      "Clients using this key start receiving 401s within ~60 seconds. This cannot be undone: revoked keys are never reactivated.",
    confirmLabel: "Revoke key",
    tone: "danger",
  },
} as const;

/** Your router decides what a click on a link does; the example just reports the address. */
type Navigate = (args: { href: string }) => void;

export function ResourceDetail({
  start = {},
  onNavigate = () => undefined,
}: {
  start?: ResourceDetailStart;
  onNavigate?: Navigate;
}) {
  const [key, setKey] = useState<VirtualKey>({ ...SEED_KEY, ...start.key });
  const [view, setView] = useState<DetailView>(start.view ?? "ready");
  const [confirm, setConfirm] = useState<"disable" | "revoke" | null>(start.confirm ?? null);
  const [language, setLanguage] = useState<Language>("python");
  const [refocus, setRefocus] = useState<"enable" | "audit" | null>(null);
  const enableButton = useRef<HTMLButtonElement>(null);
  const auditLink = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (refocus === null || confirm !== null) return;
    const frame = requestAnimationFrame(() => {
      (refocus === "enable" ? enableButton : auditLink).current?.focus();
      setRefocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [refocus, confirm]);

  const goTo = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (isBrowserClick(event)) return;
    event.preventDefault();
    onNavigate({ href });
  };

  const confirmAction = () => {
    if (confirm === "disable") {
      setKey((current) => ({ ...current, status: "disabled" }));
      setRefocus("enable");
    }
    if (confirm === "revoke") {
      setKey((current) => ({ ...current, status: "revoked" }));
      setRefocus("audit");
    }
    setConfirm(null);
  };

  const backToKeys: EmptyNext = [
    { kind: "setting", label: "Back to virtual keys", href: KEYS_HREF, onNavigate },
  ];
  const ready = view === "ready";

  return (
    <ProductScope product="gateway">
      <PageLayout.Header
        description={ready ? key.description : undefined}
        actions={
          ready && (
            <>
              {key.status === "active" && (
                <PageLayout.HeaderButton onClick={() => setConfirm("disable")}>
                  Disable
                </PageLayout.HeaderButton>
              )}
              {key.status === "disabled" && (
                <PageLayout.HeaderButton
                  ref={enableButton}
                  onClick={() => setKey((current) => ({ ...current, status: "active" }))}
                >
                  Enable
                </PageLayout.HeaderButton>
              )}
              {key.status !== "revoked" && (
                <PageLayout.HeaderButton onClick={() => setConfirm("revoke")}>
                  Revoke
                </PageLayout.HeaderButton>
              )}
            </>
          )
        }
      >
        <PageLayout.Heading>{ready ? key.name : "Virtual key"}</PageLayout.Heading>
      </PageLayout.Header>

      <PageLayout.Container width="fill">
        {view === "loading" && <LoadingDetail />}
        {view === "missing" && (
          <NoDataInfoBlock
            title="Virtual key not found"
            description="It may have been deleted, or the link may be wrong. Pick a key from the list."
            icon={<Text aria-hidden>?</Text>}
            next={backToKeys}
          />
        )}
        {view === "failed" && (
          <NoDataInfoBlock
            title="Couldn't load this virtual key"
            description="The gateway did not answer. Your key is unchanged."
            icon={<Text aria-hidden>!</Text>}
            primaryAction={
              <Button size="sm" onClick={() => setView("ready")}>
                Try again
              </Button>
            }
            next={backToKeys}
          />
        )}
        {ready && (
          <Box css={{ containerType: "inline-size" }}>
            <Grid gap={6} alignItems="start" css={DETAIL_GRID}>
              <GridItem gridArea="facts" minWidth={0}>
                <Box display="flex" flexDirection="column" gap={6}>
                  <IdentityCard vk={key} />
                  <ActivityCard vk={key} auditLink={auditLink} goTo={goTo} />
                </Box>
              </GridItem>
              <GridItem gridArea="main" minWidth={0}>
                <Box display="flex" flexDirection="column" gap={6}>
                  <UsageExample language={language} onLanguageChange={setLanguage} />
                  <ScopeCard vk={key} />
                  <UsageCard vk={key} />
                </Box>
              </GridItem>
            </Grid>
          </Box>
        )}
      </PageLayout.Container>

      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title={CONFIRMS[confirm].title(key.name)}
          description={CONFIRMS[confirm].description}
          confirmLabel={CONFIRMS[confirm].confirmLabel}
          tone={CONFIRMS[confirm].tone}
          onConfirm={confirmAction}
        />
      )}
    </ProductScope>
  );
}

function LoadingDetail() {
  return (
    <Box
      as="output"
      aria-busy="true"
      aria-label="Loading virtual key"
      css={{ containerType: "inline-size" }}
    >
      <Grid gap={6} alignItems="start" css={DETAIL_GRID}>
        <GridItem gridArea="facts">
          <Box display="flex" flexDirection="column" gap={6}>
            <SkeletonCard lines={3} label="Loading identity" />
            <SkeletonCard lines={3} label="Loading activity" />
          </Box>
        </GridItem>
        <GridItem gridArea="main">
          <Box display="flex" flexDirection="column" gap={6}>
            <SkeletonCard lines={8} label="Loading usage example" />
            <SkeletonCard lines={3} label="Loading scope" />
          </Box>
        </GridItem>
      </Grid>
    </Box>
  );
}

function IdentityCard({ vk }: { vk: VirtualKey }) {
  return (
    <Card title="Identity">
      <SummaryList>
        <SummaryListItem label="Name">{vk.name}</SummaryListItem>
        <SummaryListItem label="Prefix">
          <InlineCode variant="neutral">{`${vk.prefix}…`}</InlineCode>
        </SummaryListItem>
        <SummaryListItem label="Status">
          <Badge colorPalette={STATUS_PALETTE[vk.status]} textTransform="capitalize">
            {vk.status}
          </Badge>
        </SummaryListItem>
        <SummaryListItem label="Expires">{vk.expires ?? "Never"}</SummaryListItem>
      </SummaryList>
    </Card>
  );
}

function ActivityCard({
  vk,
  auditLink,
  goTo,
}: {
  vk: VirtualKey;
  auditLink: RefObject<HTMLAnchorElement | null>;
  goTo: (href: string) => (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const audit = `/settings/audit-log?targetKind=virtual_key&targetId=${vk.id}`;
  const traces = `/support-assistant/messages?virtualKey=${vk.id}`;
  return (
    <Card
      title="Activity"
      footer={
        <>
          <Button asChild size="xs" variant="outline">
            <a ref={auditLink} href={audit} onClick={goTo(audit)}>
              Audit history
            </a>
          </Button>
          <Button asChild size="xs" variant="outline">
            <a href={traces} onClick={goTo(traces)}>
              View traces
            </a>
          </Button>
        </>
      }
    >
      <SummaryList>
        <SummaryListItem label="Last used">{vk.lastUsed ?? "Never"}</SummaryListItem>
        <SummaryListItem label="Created">{vk.created}</SummaryListItem>
        <SummaryListItem label="Revision">{vk.revision}</SummaryListItem>
      </SummaryList>
    </Card>
  );
}

function UsageExample({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <Text fontWeight="medium">Usage example</Text>
      <Text textStyle="xs" color="fg.muted">
        Works with any OpenAI-compatible SDK or coding assistant (Claude Code, Codex, Cursor,
        Aider).{" "}
        <Link href={DOCS} target="_blank" rel="noreferrer">
          Read more →
        </Link>
      </Text>
      <CodeTabs<Language>
        label="Snippet language"
        value={language}
        onValueChange={({ value }) => onLanguageChange(value)}
        items={SNIPPETS}
      />
    </Box>
  );
}

function ScopeCard({ vk }: { vk: VirtualKey }) {
  return (
    <Card title="Scope & routing">
      <SummaryList>
        <SummaryListItem label="Scope">
          <ProviderScopeChips scopes={vk.scopes} />
        </SummaryListItem>
        <SummaryListItem label="Routing policy">{vk.routingPolicy}</SummaryListItem>
        <SummaryListItem label="Providers">
          <Box display="flex" gap={1} flexWrap="wrap">
            {vk.providers.map((provider) => (
              <Badge key={provider} colorPalette="gray" variant="subtle">
                {provider}
              </Badge>
            ))}
          </Box>
        </SummaryListItem>
      </SummaryList>
    </Card>
  );
}

function UsageCard({ vk }: { vk: VirtualKey }) {
  const requests = vk.usage.reduce((sum, row) => sum + row.requests, 0);
  const cents = vk.usage.reduce((sum, row) => sum + row.cents, 0);
  return (
    <Card
      title="Usage, last 30 days"
      description={
        vk.usage.length > 0
          ? `${requests.toLocaleString("en-US")} requests and ${(cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} across ${vk.usage.length} models. Amounts are in US dollars.`
          : undefined
      }
      padding="none"
    >
      {vk.usage.length === 0 ? (
        <NoDataInfoBlock
          size="inline"
          bordered={false}
          title="No requests yet"
          description="Once a client sends a request with this key, its spend by model appears here."
          icon={<Text aria-hidden>0</Text>}
          next={[{ kind: "docs", label: "Send a first request", href: DOCS }]}
        />
      ) : (
        <ListTable aria-label="Spend by model">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Model</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Requests</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Spend</ListTable.ColumnHeader>
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {vk.usage.map((row) => (
              <ListTable.Row key={row.model}>
                <ListTable.Cell>{row.model}</ListTable.Cell>
                <ListTable.Cell numeric>{row.requests.toLocaleString("en-US")}</ListTable.Cell>
                <ListTable.Cell numeric>
                  <Money
                    amount={row.cents / 100}
                    currency="USD"
                    locale="en-US"
                    precision="exact"
                    plain
                  />
                </ListTable.Cell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      )}
    </Card>
  );
}
