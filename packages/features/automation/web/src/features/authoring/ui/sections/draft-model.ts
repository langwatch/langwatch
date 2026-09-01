import {
  INITIAL_GRAPH_ALERT_DRAFT,
  INITIAL_REPORT_DRAFT,
  type AutomationDraft as WebAutomationDraft,
  type AutomationFilterValue,
  type AutomationFilters,
  type ConditionSource,
  type DraftAction as WebDraftAction,
  type GraphAlertDraft,
  type PresetLabels,
  type ReportDraft,
  type ReportSourceKind,
  type SetSliceAction as WebSetSliceAction,
} from "../../model/draft-reducer";
import { OPERATOR_LABELS, TIME_PERIOD_LABELS } from "../../model/draft-reducer";
import {
  AUTOMATION_DRAFT_MODEL,
  type AllSlices,
  type AutomationProviderClients,
} from "./client-providers";

const model = AUTOMATION_DRAFT_MODEL;

export type AutomationDraft = WebAutomationDraft<AutomationProviderClients>;
export type DraftAction = WebDraftAction<AutomationProviderClients>;
export type SetSliceAction = WebSetSliceAction<AutomationProviderClients>;

export type {
  AllSlices,
  AutomationFilterValue,
  AutomationFilters,
  ConditionSource,
  GraphAlertDraft,
  PresetLabels,
  ReportDraft,
  ReportSourceKind,
};

export { INITIAL_GRAPH_ALERT_DRAFT, INITIAL_REPORT_DRAFT };

export const INITIAL_DRAFT = model.INITIAL_DRAFT;
export const reducer = model.reducer;
export const notifyChannel = model.notifyChannel;
export const templatesFromDraft = model.templatesFromDraft;
export const buildTestFirePayload = model.buildTestFirePayload;
export const actionParamsFromDraft = model.actionParamsFromDraft;
export const filtersAreSet = model.filtersAreSet;
export const subjectIsSet = model.subjectIsSet;
export const filterQueryIsSet = model.filterQueryIsSet;
export const cadenceIsSet = model.cadenceIsSet;
export const conditionsAreSet = model.conditionsAreSet;
export const configIsComplete = model.configIsComplete;
export const configurationSummary = model.configurationSummary;
export const isNotifyAction = model.isNotifyAction;
export const presetLabels = model.presetLabels;
export const extractGraphAlertFromTriggerRow = model.extractGraphAlertFromTriggerRow;
export const extractReportFromTriggerRow = model.extractReportFromTriggerRow;
export const reportInputFromDraft = model.reportInputFromDraft;
export { OPERATOR_LABELS, TIME_PERIOD_LABELS };
