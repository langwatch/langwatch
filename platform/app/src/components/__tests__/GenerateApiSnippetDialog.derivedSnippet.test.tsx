/**
 * @vitest-environment jsdom
 *
 * Regression tests for the nested-update storm behind React #185 (PR #6931).
 *
 * The dialog used to sync `selectedSnippet` into state via an effect keyed on
 * `snippets`. Callers build `snippets` in their render body, so every parent
 * render handed the effect a fresh array identity, and the effect answered
 * with a setState — one extra commit per parent render, and inside a route
 * transition's passive-effect cascade enough to trip React's 50-nested-update
 * clamp and wedge navigation. The fix derives the selection with `useMemo`.
 *
 * These tests pin the two observable halves of that fix: re-rendering with
 * fresh `snippets` identities must not produce effect-driven extra commits,
 * and the derived selection must still track both the array and the chosen
 * target.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { Profiler } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Snippet, Target } from "@langwatch/prompt-web/surfaces/api-snippet";
import { GenerateApiSnippetDialog } from "../GenerateApiSnippetDialog";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/** Fresh array + fresh element identities every call, like the real callers. */
function buildSnippets(): Snippet[] {
  return [
    {
      content: "print('python')",
      target: "python_python3" as Target,
      title: "Python",
    },
    {
      content: "curl https://example.test",
      target: "shell_curl" as Target,
      title: "Shell",
    },
  ];
}

const targets: Target[] = ["python_python3" as Target, "shell_curl" as Target];

describe("GenerateApiSnippetDialog derived snippet selection", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not add effect-driven commits when snippets get a new identity each render", () => {
    let commits = 0;
    const dialog = (snippets: Snippet[]) => (
      <Profiler id="snippet-dialog" onRender={() => commits++}>
        <GenerateApiSnippetDialog snippets={snippets} targets={targets} />
      </Profiler>
    );

    const { rerender } = render(dialog(buildSnippets()), { wrapper: Wrapper });

    // Let mount effects (Chakra disclosure etc.) settle, then count only the
    // commits the identity churn itself causes.
    commits = 0;
    const rerenders = 5;
    for (let i = 0; i < rerenders; i++) {
      rerender(dialog(buildSnippets()));
    }

    // One commit per rerender. The old effect-sync answered every fresh
    // `snippets` identity with a setState, doubling this to 2x — and storming
    // under a route transition's passive-effect cascade.
    expect(commits).toBe(rerenders);
  });

  it("keeps showing the derived snippet across identity churn", () => {
    const dialog = (snippets: Snippet[]) => (
      <GenerateApiSnippetDialog snippets={snippets} targets={targets} open />
    );

    const { rerender } = render(dialog(buildSnippets()), { wrapper: Wrapper });
    expect(screen.getByText(/print\('python'\)/)).toBeInTheDocument();

    rerender(dialog(buildSnippets()));
    expect(screen.getByText(/print\('python'\)/)).toBeInTheDocument();
  });

  it("falls back to the first snippet when none matches the selected target", () => {
    const shellOnly: Snippet[] = [
      {
        content: "curl https://example.test",
        target: "shell_curl" as Target,
        title: "Shell",
      },
    ];

    render(
      <GenerateApiSnippetDialog
        snippets={shellOnly}
        targets={["python_python3" as Target]}
        open
      />,
      { wrapper: Wrapper },
    );

    expect(screen.getByText(/curl https:\/\/example\.test/)).toBeInTheDocument();
  });
});
