import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { uiFeature } from "../ui-feature";

type PromptApiMap = {
  prompts: { getById: { query: { input: { id: string }; output: { id: string } } } };
};

describe("given a feature package's typed hooks", () => {
  describe("when the application declares that they run on its transport", () => {
    it("keeps the feature's own Provider, named for composition diagnostics", () => {
      const Provider = ({
        children,
      }: {
        client: PromptApiMap;
        queryClient: QueryClient;
        children: ReactNode;
      }) => children;

      const feature = uiFeature<PromptApiMap, Record<string, never>>({
        name: "@langwatch/prompt-browser",
        api: { Provider },
      });

      expect(feature.api?.name).toBe("@langwatch/prompt-browser");
      expect(feature.api?.Provider).toBe(Provider);
    });
  });
});
