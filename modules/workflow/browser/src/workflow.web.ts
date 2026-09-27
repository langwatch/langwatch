/**
 * What a browser installs when it installs workflow: the workflow list, the
 * Optimization Studio, and the workflow chat.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const workflowWeb = defineWebModule("workflow")
  .withScreens({
    "pages/[project]/workflows": {
      load: () => import("./ui/sections/workflows/workflows-screen.tsx"),
    },
    "pages/[project]/studio/[workflow]": {
      load: () => import("./ui/sections/workflows/studio-screen.tsx"),
    },
    "pages/[project]/chat/[workflow]": {
      load: () => import("./ui/sections/workflows/workflow-chat-screen.tsx"),
    },
  })
  /** The expandable text and the redaction marker, lent to evaluator (§3.4 rule 7). */
  .withCapabilities({
    hoverableBigText: {
      load: async () => ({
        default: (await import("./ui/sections/hoverable-big-text.tsx")).HoverableBigText,
      }),
    },
    redactedField: {
      load: async () => ({
        default: (await import("./ui/sections/redacted-field.tsx")).RedactedField,
      }),
    },
  });
