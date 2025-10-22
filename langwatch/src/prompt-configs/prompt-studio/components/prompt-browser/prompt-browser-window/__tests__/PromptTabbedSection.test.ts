import { describe, it } from "vitest";

describe("PromptTabbedSection", () => {
  describe("tab structure", () => {
    describe("when component renders", () => {
      it.todo("should render conversation, variables, and settings tabs");
      it.todo("should default to conversation tab");
      it.todo("should use orange color palette");
      it.todo("should display tabs in correct order");
    });
  });

  describe("conversation tab", () => {
    describe("when conversation tab is active", () => {
      it.todo("should render PromptStudioChat component");
      it.todo("should pass form values to chat component");
      it.todo("should have full width and height");
      it.todo("should be positioned absolutely at bottom");
      it.todo("should have scrollable overflow");
    });
  });

  describe("variables tab", () => {
    describe("when variables tab is active", () => {
      it.todo("should render variables content");
      it.todo("should have full height and width");
    });
  });

  describe("settings tab", () => {
    describe("when settings tab is active", () => {
      it.todo("should render SettingsTabContent component");
      it.todo("should have full height and width");
      it.todo("should be flex enabled");
    });
  });

  describe("form integration", () => {
    describe("when form context is available", () => {
      it.todo("should use form context for PromptConfigFormValues");
      it.todo("should get form values for chat component");
      it.todo("should handle form state changes");
    });
  });

  describe("layout", () => {
    describe("when component is rendered", () => {
      it.todo("should use flex column layout");
      it.todo("should have full width");
      it.todo("should have flex 1 for main content");
      it.todo("should stack tabs horizontally");
    });
  });
});
