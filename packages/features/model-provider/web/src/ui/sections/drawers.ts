/**
 * The URL-addressed drawers this family owns.
 *
 * ONE PUBLIC ENTRY FOR THE WHOLE SET, the shape
 * `@langwatch/evaluator-web/drawers` established: the composing application
 * spreads a map of these into its drawer registry, so what it may name is one
 * entry rather than a path per component.
 *
 * EVERY ONE OF THESE CAME BACK FROM `platform/app`, deleted in `cc91631cd8` and
 * recorded as group (c) in `dev/docs/plans/ownerless-ui-surfaces-census.md` —
 * addressed by a live screen, answered by nothing. Until they landed, a
 * customer could not add or edit a model-provider credential, could not
 * configure a default model, and could not edit a model cost: three settings
 * pages whose every write affordance changed the URL and opened nothing.
 *
 * THE CLOSE GOES THROUGH `@langwatch/ui-drawer`, not through a prop. That
 * package IS the drawer framework — it owns the `?drawer.open=` vocabulary, the
 * navigation stack and the in-memory prop slots, and it names no drawer — so a
 * feature may depend on it. What a feature may not carry is the REGISTRY, which
 * is composition and stays in `apps/ui/src/features/installed-ui-drawers.ts`.
 *
 * `CodexCodingDefaultsAskHost` IS NOT A DRAWER, and it is published here because
 * it is the other half of one. The provider editor's Codex sign-in closes the
 * drawer the moment the connect completes, so the question it has to ask next —
 * "should this account become your coding default?" — cannot be mounted inside
 * the drawer that queues it. The Model Providers screen mounts this host, and
 * the two talk through the store below.
 */

export {
  CodexCodingDefaultsAskHost,
  useCodexCodingDefaultsAskStore,
} from "./codex-coding-defaults-ask";
export { DefaultModelOverrideDrawer } from "./default-model-override-drawer";
export { EditModelProviderDrawer } from "./edit-model-provider-drawer";
export { LLMModelCostDrawer } from "./llm-model-cost-drawer";
