/**
 * What a reader may do with a board in the project they are in, and the words the product
 * says about a board's scope.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import {
  BOARD_UNAVAILABLE,
  boardAccess,
  type BoardReader,
  DASHBOARD_SCOPES,
  fromOrganizationLabel,
  guestBadgeLabel,
  PROJECT_CHIP,
  projectMenuNote,
  SCOPE_LABEL,
  SCOPE_MENU,
  scopeChangedNote,
  scopeConfirmWords,
  type ScopedBoard,
  scopeHint,
  scopeLockedTip,
  scopeMarkTip,
} from "../model/board-scope.ts";

const NAMES = { project: "Checkout", organization: "Acme" };

const board = (overrides: Partial<ScopedBoard> = {}): ScopedBoard => ({
  id: "board-1",
  name: "Weekly review",
  projectId: "proj-1",
  createdById: "user-1",
  scope: "PROJECT",
  organizationId: null,
  ...overrides,
});

const reader = (overrides: Partial<BoardReader> = {}): BoardReader => ({
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  mayCreate: true,
  mayEdit: true,
  mayDelete: true,
  ...overrides,
});

describe("what the scope control says", () => {
  /** @scenario "AC177 Scope control: the board header shows the scope beside the title" */
  it("names the three scopes as the prompt scope does, with who sees each", () => {
    expect({
      menu: SCOPE_MENU,
      choices: DASHBOARD_SCOPES.map((scope) => [
        SCOPE_LABEL[scope],
        scopeHint({ scope, names: NAMES }),
      ]),
    }).toEqual({
      menu: { title: "Scope", hint: "Who can see this dashboard." },
      choices: [
        ["Only me", "Only you"],
        ["Project", "Everyone in Checkout"],
        ["Organization", "Everyone in Acme, in each of their projects"],
      ],
    });
  });

  /** @scenario "AC177 Scope control: the board header shows the scope beside the title" */
  it("tells a reader who did not make the board that only its maker changes the scope", () => {
    expect(scopeLockedTip({ scope: "PROJECT", lock: "not-author", names: NAMES })).toBe(
      "Everyone in Checkout can see this dashboard. Only the person who made this dashboard can change its scope.",
    );
  });
});

describe("what a change of scope says", () => {
  /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
  it("says how many other people starred a board going to Only me", () => {
    const words = scopeConfirmWords({
      board: "Weekly review",
      from: "PROJECT",
      to: "PRIVATE",
      names: NAMES,
      otherStars: 2,
    });

    expect(words).toEqual({
      title: 'Make "Weekly review" visible only to you?',
      message:
        "It leaves the Dashboards list of everyone else in Checkout. Anyone who has it open is told it is not available the next time it loads. 2 other people starred it. Their stars are kept, and come back if you widen the scope again.",
      confirmLabel: "Set to Only me",
    });
  });

  /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
  it("says the other projects will no longer see a board lowered from Organization", () => {
    const words = scopeConfirmWords({
      board: "Weekly review",
      from: "ORGANIZATION",
      to: "PROJECT",
      names: NAMES,
      otherStars: 0,
    });

    expect(words).toEqual({
      title: 'Show "Weekly review" only to Checkout?',
      message:
        'People in the other projects of Acme will no longer see it. It leaves their "From Acme" list. Copies they made stay theirs.',
      confirmLabel: "Set to Project",
    });
  });

  /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
  it("counts one other person as one", () => {
    const { message } = scopeConfirmWords({
      board: "Weekly review",
      from: "ORGANIZATION",
      to: "PRIVATE",
      names: NAMES,
      otherStars: 1,
    });

    expect(message).toContain("1 other person starred it.");
  });

  /** @scenario "AC180 Scope change: any other change is made at once and offers Undo" */
  it("names the new audience in the note that offers Undo", () => {
    const note = (to: "PRIVATE" | "PROJECT" | "ORGANIZATION") =>
      scopeChangedNote({ board: "Weekly review", to, names: NAMES });

    expect([note("PRIVATE"), note("PROJECT"), note("ORGANIZATION")]).toEqual([
      'Only you can see "Weekly review" now',
      'Everyone in Checkout can see "Weekly review" now',
      'Everyone in Acme can see "Weekly review" now, each with their own project\'s data',
    ]);
  });
});

describe("what the sidebar says of a board's scope", () => {
  /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
  it("marks an Only me board and an Organization board, and leaves a Project board bare", () => {
    const tip = (scope: "PRIVATE" | "PROJECT" | "ORGANIZATION") =>
      scopeMarkTip({ scope, organization: "Acme" });

    expect([tip("PRIVATE"), tip("PROJECT"), tip("ORGANIZATION")]).toEqual([
      "Only you can see this dashboard",
      void 0,
      "Everyone in Acme can see this dashboard, in each of their projects",
    ]);
  });

  /** @scenario "AC181 Sidebar: scope marks and the organization's group" */
  it("names the group of other projects' boards after the organization", () => {
    expect(fromOrganizationLabel("Acme")).toBe("From Acme");
  });
});

describe("what the Project chip says", () => {
  /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
  it("says whose data the board shows, one project at a time, and tags the owner", () => {
    expect(PROJECT_CHIP).toEqual({
      name: "Project",
      menuHint: "Whose data this dashboard shows. One project at a time.",
      ownerTag: "owner",
    });
  });

  /** @scenario "AC182 Organization board: the Project chip says whose data it shows" */
  it("keeps who can edit apart from whose data is shown", () => {
    const note = (isHere: boolean, canOpenOwner: boolean) =>
      projectMenuNote({ owner: "Checkout", isHere, canOpenOwner });

    expect([note(true, true), note(false, true), note(false, false)]).toEqual([
      "Checkout owns this dashboard, so it is edited here.",
      "Checkout owns this dashboard. Choose it to edit the dashboard.",
      "Checkout owns this dashboard. You do not have access to that project.",
    ]);
  });
});

describe("the page for a board the reader may not open", () => {
  /** @scenario "AC183 A board the reader may not open is not available" */
  it("says one thing for a deleted board and an Only me board", () => {
    expect(BOARD_UNAVAILABLE).toEqual({
      title: "This dashboard is not available",
      body: "It was deleted, or the person who made it set its scope to Only me. If you need it, ask them to set it to Project.",
    });
  });
});

describe("what a reader may do with a board", () => {
  describe("given the author, in the project that owns the board", () => {
    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("edits, deletes, copies and changes the scope", () => {
      expect(boardAccess({ board: board(), reader: reader() })).toEqual({
        isHome: true,
        canEdit: true,
        canDelete: true,
        canDuplicate: true,
        scopeLock: "none",
      });
    });
  });

  describe("given an Organization board opened in a project that does not own it", () => {
    const shared = board({ projectId: "proj-2", scope: "ORGANIZATION", organizationId: "org-1" });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("is view-only for everyone, its author included, who may still copy it", () => {
      expect(boardAccess({ board: shared, reader: reader() })).toEqual({
        isHome: false,
        canEdit: false,
        canDelete: false,
        canDuplicate: true,
        scopeLock: "guest",
      });
    });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("says in the header who owns it", () => {
      expect(guestBadgeLabel(NAMES)).toBe("Acme · owned by Checkout");
    });
  });

  describe("given a member without the edit permission, in the project that owns the board", () => {
    const viewer = reader({ mayCreate: false, mayEdit: false, mayDelete: false });

    /** @scenario "AC184 View-only: a board the reader cannot edit offers no edit control" */
    it("is view-only, with no copy and no scope change, on a board they made too", () => {
      expect(boardAccess({ board: board(), reader: viewer })).toEqual({
        isHome: true,
        canEdit: false,
        canDelete: false,
        canDuplicate: false,
        scopeLock: "no-permission",
      });
    });
  });

  describe("given a member who may edit a board somebody else made", () => {
    /** @scenario "AC178 Scope control: the sidebar menu offers the same three choices" */
    it("edits it, and cannot change its scope", () => {
      const access = boardAccess({ board: board({ createdById: "user-2" }), reader: reader() });

      expect({ canEdit: access.canEdit, scopeLock: access.scopeLock }).toEqual({
        canEdit: true,
        scopeLock: "not-author",
      });
    });
  });
});
