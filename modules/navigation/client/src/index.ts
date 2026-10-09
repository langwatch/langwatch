/** Navigation lent by token: the sidebar groups the tour folds, and the inline palette. */

import { uiTokens } from "@langwatch/module";

/** Navigation's sidebar groups: fold, unfold, restore each to its remembered preference. */
export type NavigationSidebar = {
  expandGroup(id: string): void;
  collapseGroup(id: string): void;
  restoreAll(): void;
};

/** What a surface hands the command palette, drawn inline rather than as the bar. */
export type InlineCommandPaletteProps = { placeholder: string };

const navigation = uiTokens("navigation");

export const SidebarToken = navigation.hooks<NavigationSidebar>("sidebar");
export const InlineCommandPaletteToken =
  navigation.component<InlineCommandPaletteProps>("inlineCommandPalette");
