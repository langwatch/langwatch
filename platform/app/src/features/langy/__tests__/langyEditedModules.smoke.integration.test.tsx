/**
 * @vitest-environment jsdom
 *
 * A cheap smoke check that every module touched in this change parses and its
 * imports resolve — a stand-in for the full typecheck. It only asserts the
 * public entry points exist; behaviour is pinned by the dedicated tests.
 */
import { describe, expect, it } from "vitest";

import { LangyGitHubConnectCard } from "../components/github/LangyGitHubConnectCard";
import { useGitHubConnectPopup } from "../components/github/useGitHubConnectPopup";
import { LangySkillChipView } from "../components/LangySkillChip";
import { MessageContent, ProposalCard } from "../components/MessageContent";

describe("given the edited Langy modules", () => {
  it("exports their public entry points", () => {
    expect(typeof LangyGitHubConnectCard).toBe("function");
    expect(typeof useGitHubConnectPopup).toBe("function");
    expect(typeof LangySkillChipView).toBe("function");
    // React.memo returns a component object under React 19.
    expect(MessageContent).toBeDefined();
    expect(typeof ProposalCard).toBe("function");
  });
});
