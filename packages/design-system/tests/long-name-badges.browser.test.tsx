/**
 * A user-supplied name in a badge or scope chip truncates inside its cell and
 * names itself on hover, so one long value cannot stretch a table off-screen.
 */

import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { ProviderScopeChips } from "../src/components/scope/provider-scope-chips.tsx";
import { Badge, Table, Text } from "../src/primitives.ts";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const LONG_NAME = "A".repeat(300);
const SHOTS = "/Users/lw/Source/github.com/langwatch/langwatch/.claude/tmp/long-names";

afterEach(() => cleanup());

describe("a table row with 300-character names", () => {
  it("keeps the table inside the viewport and every name truncated", async () => {
    await page.viewport(1280, 300);
    const { container } = renderWithDesignSystem(
      <Table.Root width="full">
        <Table.Body>
          <Table.Row>
            <Table.Cell minWidth="220px">Local Dev Private Access Token</Table.Cell>
            <Table.Cell maxWidth="240px">
              <Badge variant="outline" title={LONG_NAME}>
                <Text truncate>{LONG_NAME}</Text>
              </Badge>
            </Table.Cell>
            <Table.Cell maxWidth="240px">
              <ProviderScopeChips
                scopes={[{ scopeType: "ORGANIZATION", scopeId: "o", name: LONG_NAME }]}
              />
            </Table.Cell>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    );

    const table = container.querySelector("table");
    expect(table?.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    const text = Array.from(container.querySelectorAll("p")).filter(
      (element) => element.textContent === LONG_NAME,
    );
    expect(text.length).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/badge-chip-table.png` });
    for (const element of text) expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
    await page.screenshot({ path: `${SHOTS}/badge-chip-table.png` });
  });
});
