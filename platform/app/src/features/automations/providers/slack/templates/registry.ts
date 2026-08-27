/**
 * Compatibility import for the app-owned Slack provider. Template definitions
 * are reusable browser behaviour and live in automation-web; this path keeps
 * the app provider transport/composition layer independent of platform/app.
 */
export {
  SLACK_BLOCK_KIT_TEMPLATES,
  findTemplateOptionBySource,
  pickDefaultSlackBlockKitTemplateId,
  reportSourceIsAutoLayout,
  templateOptionsFor,
} from "@langwatch/automation-web";
