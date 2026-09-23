import { childNodes, walk } from "./ast.mjs";
import {
  classify,
  normalizedFilename,
  resetClassificationCache,
  workspacePathOf,
} from "./classify.mjs";
import { defineRule, renderMessage, renderTemplate } from "./define-rule.mjs";
import { bannedTestModelNamesRule } from "./rules/banned-test-model-names.rule.mjs";
import { bannedVerbPrefixRule } from "./rules/banned-verb-prefix.rule.mjs";
import { clickhouseNoVersionOrderLimitRule } from "./rules/clickhouse-no-version-order-limit.rule.mjs";
import { clickhouseTenantIdRule } from "./rules/clickhouse-tenant-id.rule.mjs";
import {
  cognitiveComplexity,
  cognitiveComplexityRule,
} from "./rules/cognitive-complexity.rule.mjs";
import {
  commentBlockAnalysis,
  commentBlockSizeRule,
  isCommentScannedPath,
} from "./rules/comment-block-size.rule.mjs";
import { conditionShape, conditionShapeRule } from "./rules/condition-shape.rule.mjs";
import { conditionalTypeDepthRule } from "./rules/conditional-type-depth.rule.mjs";
import { emDashInCopyRule } from "./rules/em-dash-in-copy.rule.mjs";
import { enterpriseLicenseHeaderRule } from "./rules/enterprise-license-header.rule.mjs";
import { environmentBoundariesRule } from "./rules/environment-boundaries.rule.mjs";
import { eventingRolePurityRule } from "./rules/eventing-role-purity.rule.mjs";
import { fallibleResultNamingRule } from "./rules/fallible-result-naming.rule.mjs";
import { featureSourceFilenameRule } from "./rules/feature-source-filename.rule.mjs";
import { featureSourceLayoutRule } from "./rules/feature-source-layout.rule.mjs";
import { featureSourceSubjectRule } from "./rules/feature-source-subject.rule.mjs";
import { handledErrorOutsideContractRule } from "./rules/handled-error-outside-contract.rule.mjs";
import { idGenerationOriginRule } from "./rules/id-generation-origin.rule.mjs";
import { idempotencyKeyIsStableRule } from "./rules/idempotency-key-is-stable.rule.mjs";
import { jsxFromHookRule } from "./rules/jsx-from-hook.rule.mjs";
import { legacyMonolithPathRule } from "./rules/legacy-monolith-path.rule.mjs";
import { moduleClassesRule } from "./rules/module-classes.rule.mjs";
import { moduleLayersRule } from "./rules/module-layers.rule.mjs";
import { namespaceClassRule } from "./rules/namespace-class.rule.mjs";
import { noAliasReexportRule } from "./rules/no-alias-reexport.rule.mjs";
import { noBootHookOutsideGuardRule } from "./rules/no-boot-hook-outside-guard.rule.mjs";
import { noFormWatchInChildRule } from "./rules/no-form-watch-in-child.rule.mjs";
import { noInlineDynamicImportRule } from "./rules/no-inline-dynamic-import.rule.mjs";
import { noLoggerSpyRule } from "./rules/no-logger-spy.rule.mjs";
import { noPortVocabularyRule } from "./rules/no-port-vocabulary.rule.mjs";
import { noPrototypeStubRule } from "./rules/no-prototype-stub.rule.mjs";
import { noRuntimeReflectionRule } from "./rules/no-runtime-reflection.rule.mjs";
import { noTautologicalAssertionRule } from "./rules/no-tautological-assertion.rule.mjs";
import { overloadByLiteralRule } from "./rules/overload-by-literal.rule.mjs";
import { boundaryRule } from "./rules/package-boundaries.rule.mjs";
import { passThroughClassRule } from "./rules/pass-through-class.rule.mjs";
import { planLiteralsRule } from "./rules/plan-literals.rule.mjs";
import { prismaCountInListQueryRule } from "./rules/prisma-count-in-list-query.rule.mjs";
import { refusalIsAHandledErrorRule } from "./rules/refusal-is-a-handled-error.rule.mjs";
import { requireFetchTimeoutRule } from "./rules/require-fetch-timeout.rule.mjs";
import { restRouteRule } from "./rules/rest-route.rule.mjs";
import { schemaOutsideContractRule } from "./rules/schema-outside-contract.rule.mjs";
import { serviceDoesNotOpenAChannelRule } from "./rules/service-does-not-open-a-channel.rule.mjs";
import { serviceLoadsItsOwnConfigRule } from "./rules/service-loads-its-own-config.rule.mjs";
import { sharedSetupIsAHookRule } from "./rules/shared-setup-is-a-hook.rule.mjs";
import { signatureMirrorRule } from "./rules/signature-mirror.rule.mjs";
import { standInCastRule } from "./rules/stand-in-cast.rule.mjs";
import { storeContainmentRule } from "./rules/store-containment.rule.mjs";
import { temporalOnlyRule } from "./rules/temporal-only.rule.mjs";
import { testDescriptionIsAnActionRule } from "./rules/test-description-is-an-action.rule.mjs";
import { transportDeclaresRule } from "./rules/transport-declares.rule.mjs";
import { unboundedLoopRule } from "./rules/unbounded-loop.rule.mjs";
import { unitTestDoesNotRenderRule } from "./rules/unit-test-does-not-render.rule.mjs";
import {
  resetUnresolvedImportCache,
  unresolvedRelativeImportRule,
} from "./rules/unresolved-relative-import.rule.mjs";
import { webImportsServerShapedValueRule } from "./rules/web-imports-server-shaped-value.rule.mjs";
import { zodInternalsRule } from "./rules/zod-internals.rule.mjs";
import { zodObjectCompositionRule } from "./rules/zod-object-composition.rule.mjs";

const RULES = [
  enterpriseLicenseHeaderRule,
  eventingRolePurityRule,
  signatureMirrorRule,
  transportDeclaresRule,
  clickhouseNoVersionOrderLimitRule,
  clickhouseTenantIdRule,
  noFormWatchInChildRule,
  noTautologicalAssertionRule,
  requireFetchTimeoutRule,
  bannedVerbPrefixRule,
  moduleClassesRule,
  moduleLayersRule,
  passThroughClassRule,
  restRouteRule,
  storeContainmentRule,
  unresolvedRelativeImportRule,
  bannedTestModelNamesRule,
  cognitiveComplexityRule,
  commentBlockSizeRule,
  conditionShapeRule,
  conditionalTypeDepthRule,
  emDashInCopyRule,
  environmentBoundariesRule,
  fallibleResultNamingRule,
  featureSourceFilenameRule,
  featureSourceLayoutRule,
  featureSourceSubjectRule,
  handledErrorOutsideContractRule,
  idGenerationOriginRule,
  idempotencyKeyIsStableRule,
  jsxFromHookRule,
  legacyMonolithPathRule,
  namespaceClassRule,
  noAliasReexportRule,
  noBootHookOutsideGuardRule,
  noInlineDynamicImportRule,
  noLoggerSpyRule,
  noPortVocabularyRule,
  noPrototypeStubRule,
  noRuntimeReflectionRule,
  overloadByLiteralRule,
  boundaryRule,
  planLiteralsRule,
  prismaCountInListQueryRule,
  refusalIsAHandledErrorRule,
  schemaOutsideContractRule,
  serviceDoesNotOpenAChannelRule,
  serviceLoadsItsOwnConfigRule,
  sharedSetupIsAHookRule,
  standInCastRule,
  temporalOnlyRule,
  testDescriptionIsAnActionRule,
  unboundedLoopRule,
  unitTestDoesNotRenderRule,
  webImportsServerShapedValueRule,
  zodInternalsRule,
  zodObjectCompositionRule,
];

/** Every registered rule, keyed by the name its own `defineRule` declaration carries. */
export const rules = Object.fromEntries(RULES.map((rule) => [rule.meta.docs.name, rule]));

export {
  enterpriseLicenseHeaderRule,
  eventingRolePurityRule,
  signatureMirrorRule,
  transportDeclaresRule,
  clickhouseNoVersionOrderLimitRule,
  clickhouseTenantIdRule,
  noFormWatchInChildRule,
  noTautologicalAssertionRule,
  requireFetchTimeoutRule,
  resetUnresolvedImportCache,
  bannedVerbPrefixRule,
  moduleClassesRule,
  moduleLayersRule,
  passThroughClassRule,
  restRouteRule,
  storeContainmentRule,
  unresolvedRelativeImportRule,
  childNodes,
  classify,
  defineRule,
  normalizedFilename,
  renderMessage,
  renderTemplate,
  resetClassificationCache,
  walk,
  workspacePathOf,
  cognitiveComplexity,
  commentBlockAnalysis,
  isCommentScannedPath,
  conditionShape,
  bannedTestModelNamesRule,
  cognitiveComplexityRule,
  commentBlockSizeRule,
  conditionShapeRule,
  conditionalTypeDepthRule,
  emDashInCopyRule,
  environmentBoundariesRule,
  fallibleResultNamingRule,
  featureSourceFilenameRule,
  featureSourceLayoutRule,
  featureSourceSubjectRule,
  handledErrorOutsideContractRule,
  idGenerationOriginRule,
  idempotencyKeyIsStableRule,
  jsxFromHookRule,
  legacyMonolithPathRule,
  namespaceClassRule,
  noAliasReexportRule,
  noBootHookOutsideGuardRule,
  noInlineDynamicImportRule,
  noLoggerSpyRule,
  noPortVocabularyRule,
  noPrototypeStubRule,
  noRuntimeReflectionRule,
  overloadByLiteralRule,
  boundaryRule,
  planLiteralsRule,
  prismaCountInListQueryRule,
  refusalIsAHandledErrorRule,
  schemaOutsideContractRule,
  serviceDoesNotOpenAChannelRule,
  serviceLoadsItsOwnConfigRule,
  sharedSetupIsAHookRule,
  standInCastRule,
  temporalOnlyRule,
  testDescriptionIsAnActionRule,
  unboundedLoopRule,
  unitTestDoesNotRenderRule,
  webImportsServerShapedValueRule,
  zodInternalsRule,
  zodObjectCompositionRule,
};
