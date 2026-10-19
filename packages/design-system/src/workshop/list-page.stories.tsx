import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { FilterChips } from "@langwatch/design-system/filter-chips";
import { ListPage, type ListPageState } from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Badge, Button } from "@langwatch/design-system/primitives";
import { ProductScope } from "@langwatch/design-system/product-scope";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const PROMPTS = [
  { id: "support-triage", name: "Support triage", model: "gpt-5-mini", version: 14, draft: false },
  {
    id: "refund-policy",
    name: "Refund policy answerer",
    model: "claude-sonnet-4-5",
    version: 3,
    draft: true,
  },
  {
    id: "handover-note",
    name: "Summarise a conversation for the handover note",
    model: "gemini-2.5-flash",
    version: 27,
    draft: false,
  },
];

const AGENT_PROMPT =
  'Create a LangWatch prompt called "Support triage" that sorts incoming support messages into billing, delivery and refunds.';

/** A prompts list built from the current shapes; each story forces one of the page's states. */
function PromptList({ forced }: { forced?: ListPageState | "failed" }) {
  const [query, setQuery] = useState(forced === "no-results" ? "Escalations" : "");
  const [filter, setFilter] = useState("all");

  const rows = PROMPTS.filter(
    (prompt) =>
      prompt.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === "all" || prompt.draft),
  );
  const state: ListPageState =
    forced === "failed"
      ? "error"
      : (forced ?? (rows.length === 0 && query !== "" ? "no-results" : "ready"));

  return (
    <ProductScope product="llm-ops">
      <ListPage
        title="Prompts"
        description="Instructions your agents send, with every version kept."
        actions={<PageLayout.HeaderButton primary>New prompt</PageLayout.HeaderButton>}
        state={state}
        toolbar={{
          search: {
            value: query,
            onChange: setQuery,
            placeholder: "Search prompts",
            ariaLabel: "Search prompts",
          },
          filters: (
            <FilterChips
              value={filter}
              onChange={setFilter}
              groupLabel="Filter prompts"
              items={[
                { value: "all", label: "All", count: PROMPTS.length },
                { value: "draft", label: "Drafts", count: 1 },
              ]}
            />
          ),
        }}
        error={{
          title: "Could not load the prompts",
          description: "We have been notified. Try again in a moment.",
          onRetry: () => undefined,
          next: [
            { kind: "docs", label: "Prompt troubleshooting", href: "https://docs.langwatch.ai" },
          ],
        }}
        empty={{
          title: "No prompts yet",
          description: "Prompts hold the instructions your agents send, with every version kept.",
          icon: <ColumnTypeIcon type="chat_messages" size={24} />,
          next: [
            { kind: "docs", label: "Read about prompts", href: "https://docs.langwatch.ai" },
            { kind: "agent-prompt", prompt: AGENT_PROMPT },
          ],
        }}
        noResults={{
          description: `No prompt is called "${query}".`,
          onClear: () => setQuery(""),
          next: [{ kind: "agent-prompt", prompt: AGENT_PROMPT }],
        }}
        pagination={{
          page: 1,
          pageSize: 25,
          totalCount: rows.length,
          unitLabel: "prompts",
          onPageChange: () => undefined,
          onPageSizeChange: () => undefined,
        }}
      >
        <ListTable aria-label="Prompts">
          <ListTable.Header>
            <ListTable.Row>
              <ListTable.ColumnHeader>Prompt</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Model</ListTable.ColumnHeader>
              <ListTable.ColumnHeader align="end">Version</ListTable.ColumnHeader>
              <ListTable.ColumnHeader>Status</ListTable.ColumnHeader>
              <ListTable.ActionHeader />
            </ListTable.Row>
          </ListTable.Header>
          <ListTable.Body>
            {rows.map((prompt) => (
              <ListTable.Row key={prompt.id} onActivate={() => undefined}>
                <ListTable.Cell>
                  <ListTable.RowAction onActivate={() => undefined}>
                    {prompt.name}
                  </ListTable.RowAction>
                </ListTable.Cell>
                <ListTable.Cell tone="muted">{prompt.model}</ListTable.Cell>
                <ListTable.Cell numeric>v{prompt.version}</ListTable.Cell>
                <ListTable.Cell>
                  <Badge colorPalette={prompt.draft ? "gray" : "green"}>
                    {prompt.draft ? "Draft" : "Published"}
                  </Badge>
                </ListTable.Cell>
                <ListTable.ActionCell>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button size="xs" variant="ghost" aria-label={`Actions for ${prompt.name}`}>
                        <span aria-hidden>⋮</span>
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content>
                      <Menu.Item value="duplicate">Duplicate</Menu.Item>
                      <Menu.Item value="delete" color="fg.error">
                        Delete
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                </ListTable.ActionCell>
              </ListTable.Row>
            ))}
          </ListTable.Body>
        </ListTable>
      </ListPage>
    </ProductScope>
  );
}

const meta = {
  title: "Patterns/List page",
  parameters: {
    layout: "fullscreen",
    usage: {
      use: "Any page that lists one kind of thing: a ListPage with the primary action in the header, search and filters in its toolbar, a ListTable with one native opener and an overflow menu per row, and Pagination. Loading, empty, no-results and error take the table's place, and the last three carry a next step.",
      avoid:
        "A page heading drawn by hand, a bare Table.Root, row actions as a row of buttons, or an empty state with nowhere to go. To add, change and remove rows from the list, see Create, edit and delete.",
    },
    docs: {
      description: {
        component:
          "The list on its own. The full flow with a form, a confirmation and Undo is [Create, edit and delete](?path=/docs/patterns-create-edit-and-delete--docs).",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <PromptList /> };

export const Loading: Story = { render: () => <PromptList forced="loading" /> };

/** No prompts: a docs page and a prompt for a coding agent, never a dead end. */
export const Empty: Story = { render: () => <PromptList forced="empty" /> };

/** The search matched nothing: clear it, or hand the job to a coding agent. */
export const NoResults: Story = { render: () => <PromptList forced="no-results" /> };

/** The read failed: try again, or follow the troubleshooting page. */
export const Failed: Story = { render: () => <PromptList forced="failed" /> };
