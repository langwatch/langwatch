from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_trigger_slack_body_filters_annotations_has_annotation_type_1 import (
        PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.post_api_trigger_slack_body_filters_annotations_has_annotation_type_2 import (
        PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_label_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_label_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_passed_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_score_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_score_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_label_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsLabelType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_label_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsLabelType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_passed_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsPassedType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_passed_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsPassedType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_score_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsScoreType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_score_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsScoreType2,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_state_type_1 import (
        PostApiTriggerSlackBodyFiltersEvaluationsStateType1,
    )
    from ..models.post_api_trigger_slack_body_filters_evaluations_state_type_2 import (
        PostApiTriggerSlackBodyFiltersEvaluationsStateType2,
    )
    from ..models.post_api_trigger_slack_body_filters_events_event_details_key_type_1 import (
        PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1,
    )
    from ..models.post_api_trigger_slack_body_filters_events_event_details_key_type_2 import (
        PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2,
    )
    from ..models.post_api_trigger_slack_body_filters_events_event_type_type_1 import (
        PostApiTriggerSlackBodyFiltersEventsEventTypeType1,
    )
    from ..models.post_api_trigger_slack_body_filters_events_event_type_type_2 import (
        PostApiTriggerSlackBodyFiltersEventsEventTypeType2,
    )
    from ..models.post_api_trigger_slack_body_filters_events_metrics_key_type_1 import (
        PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1,
    )
    from ..models.post_api_trigger_slack_body_filters_events_metrics_key_type_2 import (
        PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2,
    )
    from ..models.post_api_trigger_slack_body_filters_events_metrics_value_type_1 import (
        PostApiTriggerSlackBodyFiltersEventsMetricsValueType1,
    )
    from ..models.post_api_trigger_slack_body_filters_events_metrics_value_type_2 import (
        PostApiTriggerSlackBodyFiltersEventsMetricsValueType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_customer_id_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_customer_id_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_key_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataKeyType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_key_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataKeyType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_labels_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataLabelsType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_labels_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataLabelsType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_prompt_ids_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_prompt_ids_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_thread_id_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataThreadIdType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_thread_id_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataThreadIdType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_user_id_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataUserIdType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_user_id_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataUserIdType2,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_value_type_1 import (
        PostApiTriggerSlackBodyFiltersMetadataValueType1,
    )
    from ..models.post_api_trigger_slack_body_filters_metadata_value_type_2 import (
        PostApiTriggerSlackBodyFiltersMetadataValueType2,
    )
    from ..models.post_api_trigger_slack_body_filters_spans_model_type_1 import (
        PostApiTriggerSlackBodyFiltersSpansModelType1,
    )
    from ..models.post_api_trigger_slack_body_filters_spans_model_type_2 import (
        PostApiTriggerSlackBodyFiltersSpansModelType2,
    )
    from ..models.post_api_trigger_slack_body_filters_spans_type_type_1 import (
        PostApiTriggerSlackBodyFiltersSpansTypeType1,
    )
    from ..models.post_api_trigger_slack_body_filters_spans_type_type_2 import (
        PostApiTriggerSlackBodyFiltersSpansTypeType2,
    )
    from ..models.post_api_trigger_slack_body_filters_topics_subtopics_type_1 import (
        PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1,
    )
    from ..models.post_api_trigger_slack_body_filters_topics_subtopics_type_2 import (
        PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2,
    )
    from ..models.post_api_trigger_slack_body_filters_topics_topics_type_1 import (
        PostApiTriggerSlackBodyFiltersTopicsTopicsType1,
    )
    from ..models.post_api_trigger_slack_body_filters_topics_topics_type_2 import (
        PostApiTriggerSlackBodyFiltersTopicsTopicsType2,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_error_type_1 import (
        PostApiTriggerSlackBodyFiltersTracesErrorType1,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_error_type_2 import (
        PostApiTriggerSlackBodyFiltersTracesErrorType2,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_name_type_1 import (
        PostApiTriggerSlackBodyFiltersTracesNameType1,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_name_type_2 import (
        PostApiTriggerSlackBodyFiltersTracesNameType2,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_origin_type_1 import (
        PostApiTriggerSlackBodyFiltersTracesOriginType1,
    )
    from ..models.post_api_trigger_slack_body_filters_traces_origin_type_2 import (
        PostApiTriggerSlackBodyFiltersTracesOriginType2,
    )


T = TypeVar("T", bound="PostApiTriggerSlackBodyFilters")


@_attrs_define
class PostApiTriggerSlackBodyFilters:
    """Which traces the trigger fires on. An empty object fires on all of them.

    Attributes:
        topics_topics (list[str] | PostApiTriggerSlackBodyFiltersTopicsTopicsType1 |
            PostApiTriggerSlackBodyFiltersTopicsTopicsType2):
        topics_subtopics (list[str] | PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1 |
            PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2):
        metadata_user_id (list[str] | PostApiTriggerSlackBodyFiltersMetadataUserIdType1 |
            PostApiTriggerSlackBodyFiltersMetadataUserIdType2):
        metadata_thread_id (list[str] | PostApiTriggerSlackBodyFiltersMetadataThreadIdType1 |
            PostApiTriggerSlackBodyFiltersMetadataThreadIdType2):
        metadata_customer_id (list[str] | PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1 |
            PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2):
        metadata_labels (list[str] | PostApiTriggerSlackBodyFiltersMetadataLabelsType1 |
            PostApiTriggerSlackBodyFiltersMetadataLabelsType2):
        metadata_key (list[str] | PostApiTriggerSlackBodyFiltersMetadataKeyType1 |
            PostApiTriggerSlackBodyFiltersMetadataKeyType2):
        metadata_value (list[str] | PostApiTriggerSlackBodyFiltersMetadataValueType1 |
            PostApiTriggerSlackBodyFiltersMetadataValueType2):
        metadata_prompt_ids (list[str] | PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1 |
            PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2):
        traces_origin (list[str] | PostApiTriggerSlackBodyFiltersTracesOriginType1 |
            PostApiTriggerSlackBodyFiltersTracesOriginType2):
        traces_error (list[str] | PostApiTriggerSlackBodyFiltersTracesErrorType1 |
            PostApiTriggerSlackBodyFiltersTracesErrorType2):
        traces_name (list[str] | PostApiTriggerSlackBodyFiltersTracesNameType1 |
            PostApiTriggerSlackBodyFiltersTracesNameType2):
        spans_type (list[str] | PostApiTriggerSlackBodyFiltersSpansTypeType1 |
            PostApiTriggerSlackBodyFiltersSpansTypeType2):
        spans_model (list[str] | PostApiTriggerSlackBodyFiltersSpansModelType1 |
            PostApiTriggerSlackBodyFiltersSpansModelType2):
        evaluations_evaluator_id (list[str] | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2):
        evaluations_evaluator_id_guardrails_only (list[str] |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2):
        evaluations_evaluator_id_has_passed (list[str] |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2):
        evaluations_evaluator_id_has_score (list[str] |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2):
        evaluations_evaluator_id_has_label (list[str] |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2):
        evaluations_passed (list[str] | PostApiTriggerSlackBodyFiltersEvaluationsPassedType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsPassedType2):
        evaluations_score (list[str] | PostApiTriggerSlackBodyFiltersEvaluationsScoreType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsScoreType2):
        evaluations_state (list[str] | PostApiTriggerSlackBodyFiltersEvaluationsStateType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsStateType2):
        evaluations_label (list[str] | PostApiTriggerSlackBodyFiltersEvaluationsLabelType1 |
            PostApiTriggerSlackBodyFiltersEvaluationsLabelType2):
        events_event_type (list[str] | PostApiTriggerSlackBodyFiltersEventsEventTypeType1 |
            PostApiTriggerSlackBodyFiltersEventsEventTypeType2):
        events_metrics_key (list[str] | PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1 |
            PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2):
        events_metrics_value (list[str] | PostApiTriggerSlackBodyFiltersEventsMetricsValueType1 |
            PostApiTriggerSlackBodyFiltersEventsMetricsValueType2):
        events_event_details_key (list[str] | PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1 |
            PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2):
        annotations_has_annotation (list[str] | PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1 |
            PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2):
    """

    topics_topics: (
        list[str] | PostApiTriggerSlackBodyFiltersTopicsTopicsType1 | PostApiTriggerSlackBodyFiltersTopicsTopicsType2
    )
    topics_subtopics: (
        list[str]
        | PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1
        | PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2
    )
    metadata_user_id: (
        list[str]
        | PostApiTriggerSlackBodyFiltersMetadataUserIdType1
        | PostApiTriggerSlackBodyFiltersMetadataUserIdType2
    )
    metadata_thread_id: (
        list[str]
        | PostApiTriggerSlackBodyFiltersMetadataThreadIdType1
        | PostApiTriggerSlackBodyFiltersMetadataThreadIdType2
    )
    metadata_customer_id: (
        list[str]
        | PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1
        | PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2
    )
    metadata_labels: (
        list[str]
        | PostApiTriggerSlackBodyFiltersMetadataLabelsType1
        | PostApiTriggerSlackBodyFiltersMetadataLabelsType2
    )
    metadata_key: (
        list[str] | PostApiTriggerSlackBodyFiltersMetadataKeyType1 | PostApiTriggerSlackBodyFiltersMetadataKeyType2
    )
    metadata_value: (
        list[str] | PostApiTriggerSlackBodyFiltersMetadataValueType1 | PostApiTriggerSlackBodyFiltersMetadataValueType2
    )
    metadata_prompt_ids: (
        list[str]
        | PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1
        | PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2
    )
    traces_origin: (
        list[str] | PostApiTriggerSlackBodyFiltersTracesOriginType1 | PostApiTriggerSlackBodyFiltersTracesOriginType2
    )
    traces_error: (
        list[str] | PostApiTriggerSlackBodyFiltersTracesErrorType1 | PostApiTriggerSlackBodyFiltersTracesErrorType2
    )
    traces_name: (
        list[str] | PostApiTriggerSlackBodyFiltersTracesNameType1 | PostApiTriggerSlackBodyFiltersTracesNameType2
    )
    spans_type: list[str] | PostApiTriggerSlackBodyFiltersSpansTypeType1 | PostApiTriggerSlackBodyFiltersSpansTypeType2
    spans_model: (
        list[str] | PostApiTriggerSlackBodyFiltersSpansModelType1 | PostApiTriggerSlackBodyFiltersSpansModelType2
    )
    evaluations_evaluator_id: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2
    )
    evaluations_evaluator_id_guardrails_only: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
    )
    evaluations_evaluator_id_has_passed: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2
    )
    evaluations_evaluator_id_has_score: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2
    )
    evaluations_evaluator_id_has_label: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1
        | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2
    )
    evaluations_passed: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsPassedType1
        | PostApiTriggerSlackBodyFiltersEvaluationsPassedType2
    )
    evaluations_score: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsScoreType1
        | PostApiTriggerSlackBodyFiltersEvaluationsScoreType2
    )
    evaluations_state: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsStateType1
        | PostApiTriggerSlackBodyFiltersEvaluationsStateType2
    )
    evaluations_label: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEvaluationsLabelType1
        | PostApiTriggerSlackBodyFiltersEvaluationsLabelType2
    )
    events_event_type: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEventsEventTypeType1
        | PostApiTriggerSlackBodyFiltersEventsEventTypeType2
    )
    events_metrics_key: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1
        | PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2
    )
    events_metrics_value: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEventsMetricsValueType1
        | PostApiTriggerSlackBodyFiltersEventsMetricsValueType2
    )
    events_event_details_key: (
        list[str]
        | PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1
        | PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2
    )
    annotations_has_annotation: (
        list[str]
        | PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1
        | PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_trigger_slack_body_filters_annotations_has_annotation_type_1 import (
            PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_label_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_passed_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_score_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_state_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_details_key_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_type_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_key_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_value_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_customer_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_key_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_labels_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_prompt_ids_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_thread_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_user_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_value_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_model_type_1 import (
            PostApiTriggerSlackBodyFiltersSpansModelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_type_type_1 import (
            PostApiTriggerSlackBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_subtopics_type_1 import (
            PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_topics_type_1 import (
            PostApiTriggerSlackBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_error_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_name_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesNameType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_origin_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesOriginType1,
        )

        topics_topics: dict[str, Any] | list[str]
        if isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, PostApiTriggerSlackBodyFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: dict[str, Any] | list[str]
        if isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, PostApiTriggerSlackBodyFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, PostApiTriggerSlackBodyFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: dict[str, Any] | list[str]
        if isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, PostApiTriggerSlackBodyFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: dict[str, Any] | list[str]
        if isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, PostApiTriggerSlackBodyFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: dict[str, Any] | list[str]
        if isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, PostApiTriggerSlackBodyFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: dict[str, Any] | list[str]
        if isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: dict[str, Any] | list[str]
        if isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, PostApiTriggerSlackBodyFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: dict[str, Any] | list[str]
        if isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, PostApiTriggerSlackBodyFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        traces_name: dict[str, Any] | list[str]
        if isinstance(self.traces_name, list):
            traces_name = self.traces_name

        elif isinstance(self.traces_name, PostApiTriggerSlackBodyFiltersTracesNameType1):
            traces_name = self.traces_name.to_dict()
        else:
            traces_name = self.traces_name.to_dict()

        spans_type: dict[str, Any] | list[str]
        if isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, PostApiTriggerSlackBodyFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: dict[str, Any] | list[str]
        if isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, PostApiTriggerSlackBodyFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(self.evaluations_evaluator_id, PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1):
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()
        else:
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()

        evaluations_evaluator_id_guardrails_only: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_guardrails_only, list):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only

        elif isinstance(
            self.evaluations_evaluator_id_guardrails_only,
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_evaluator_id_has_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_passed, list):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed

        elif isinstance(
            self.evaluations_evaluator_id_has_passed, PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1
        ):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()
        else:
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()

        evaluations_evaluator_id_has_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_score, list):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score

        elif isinstance(
            self.evaluations_evaluator_id_has_score, PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1
        ):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()
        else:
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()

        evaluations_evaluator_id_has_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_label, list):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label

        elif isinstance(
            self.evaluations_evaluator_id_has_label, PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1
        ):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()
        else:
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()

        evaluations_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, PostApiTriggerSlackBodyFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, PostApiTriggerSlackBodyFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: dict[str, Any] | list[str]
        if isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, PostApiTriggerSlackBodyFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, PostApiTriggerSlackBodyFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: dict[str, Any] | list[str]
        if isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, PostApiTriggerSlackBodyFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, PostApiTriggerSlackBodyFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: dict[str, Any] | list[str]
        if isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: dict[str, Any] | list[str]
        if isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(self.annotations_has_annotation, PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1):
            annotations_has_annotation = self.annotations_has_annotation.to_dict()
        else:
            annotations_has_annotation = self.annotations_has_annotation.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "topics.topics": topics_topics,
                "topics.subtopics": topics_subtopics,
                "metadata.user_id": metadata_user_id,
                "metadata.thread_id": metadata_thread_id,
                "metadata.customer_id": metadata_customer_id,
                "metadata.labels": metadata_labels,
                "metadata.key": metadata_key,
                "metadata.value": metadata_value,
                "metadata.prompt_ids": metadata_prompt_ids,
                "traces.origin": traces_origin,
                "traces.error": traces_error,
                "traces.name": traces_name,
                "spans.type": spans_type,
                "spans.model": spans_model,
                "evaluations.evaluator_id": evaluations_evaluator_id,
                "evaluations.evaluator_id.guardrails_only": evaluations_evaluator_id_guardrails_only,
                "evaluations.evaluator_id.has_passed": evaluations_evaluator_id_has_passed,
                "evaluations.evaluator_id.has_score": evaluations_evaluator_id_has_score,
                "evaluations.evaluator_id.has_label": evaluations_evaluator_id_has_label,
                "evaluations.passed": evaluations_passed,
                "evaluations.score": evaluations_score,
                "evaluations.state": evaluations_state,
                "evaluations.label": evaluations_label,
                "events.event_type": events_event_type,
                "events.metrics.key": events_metrics_key,
                "events.metrics.value": events_metrics_value,
                "events.event_details.key": events_event_details_key,
                "annotations.hasAnnotation": annotations_has_annotation,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_trigger_slack_body_filters_annotations_has_annotation_type_1 import (
            PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_trigger_slack_body_filters_annotations_has_annotation_type_2 import (
            PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_label_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_passed_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_has_score_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_evaluator_id_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_label_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_label_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsLabelType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_passed_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_passed_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsPassedType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_score_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_score_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsScoreType2,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_state_type_1 import (
            PostApiTriggerSlackBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_trigger_slack_body_filters_evaluations_state_type_2 import (
            PostApiTriggerSlackBodyFiltersEvaluationsStateType2,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_details_key_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_details_key_type_2 import (
            PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_type_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_event_type_type_2 import (
            PostApiTriggerSlackBodyFiltersEventsEventTypeType2,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_key_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_key_type_2 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_value_type_1 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_trigger_slack_body_filters_events_metrics_value_type_2 import (
            PostApiTriggerSlackBodyFiltersEventsMetricsValueType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_customer_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_customer_id_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_key_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_key_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataKeyType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_labels_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_labels_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataLabelsType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_prompt_ids_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_prompt_ids_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_thread_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_thread_id_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataThreadIdType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_user_id_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_user_id_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataUserIdType2,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_value_type_1 import (
            PostApiTriggerSlackBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_trigger_slack_body_filters_metadata_value_type_2 import (
            PostApiTriggerSlackBodyFiltersMetadataValueType2,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_model_type_1 import (
            PostApiTriggerSlackBodyFiltersSpansModelType1,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_model_type_2 import (
            PostApiTriggerSlackBodyFiltersSpansModelType2,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_type_type_1 import (
            PostApiTriggerSlackBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_trigger_slack_body_filters_spans_type_type_2 import (
            PostApiTriggerSlackBodyFiltersSpansTypeType2,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_subtopics_type_1 import (
            PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_subtopics_type_2 import (
            PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_topics_type_1 import (
            PostApiTriggerSlackBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_trigger_slack_body_filters_topics_topics_type_2 import (
            PostApiTriggerSlackBodyFiltersTopicsTopicsType2,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_error_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_error_type_2 import (
            PostApiTriggerSlackBodyFiltersTracesErrorType2,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_name_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesNameType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_name_type_2 import (
            PostApiTriggerSlackBodyFiltersTracesNameType2,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_origin_type_1 import (
            PostApiTriggerSlackBodyFiltersTracesOriginType1,
        )
        from ..models.post_api_trigger_slack_body_filters_traces_origin_type_2 import (
            PostApiTriggerSlackBodyFiltersTracesOriginType2,
        )

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersTopicsTopicsType1
            | PostApiTriggerSlackBodyFiltersTopicsTopicsType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                topics_topics_type_0 = cast(list[str], data)

                return topics_topics_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                topics_topics_type_1 = PostApiTriggerSlackBodyFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = PostApiTriggerSlackBodyFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics"))

        def _parse_topics_subtopics(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1
            | PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                topics_subtopics_type_0 = cast(list[str], data)

                return topics_subtopics_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                topics_subtopics_type_1 = PostApiTriggerSlackBodyFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = PostApiTriggerSlackBodyFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics"))

        def _parse_metadata_user_id(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataUserIdType1
            | PostApiTriggerSlackBodyFiltersMetadataUserIdType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_user_id_type_0 = cast(list[str], data)

                return metadata_user_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_user_id_type_1 = PostApiTriggerSlackBodyFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = PostApiTriggerSlackBodyFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id"))

        def _parse_metadata_thread_id(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataThreadIdType1
            | PostApiTriggerSlackBodyFiltersMetadataThreadIdType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_thread_id_type_0 = cast(list[str], data)

                return metadata_thread_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_thread_id_type_1 = PostApiTriggerSlackBodyFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = PostApiTriggerSlackBodyFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id"))

        def _parse_metadata_customer_id(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1
            | PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_customer_id_type_0 = cast(list[str], data)

                return metadata_customer_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_customer_id_type_1 = PostApiTriggerSlackBodyFiltersMetadataCustomerIdType1.from_dict(data)

                return metadata_customer_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = PostApiTriggerSlackBodyFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id"))

        def _parse_metadata_labels(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataLabelsType1
            | PostApiTriggerSlackBodyFiltersMetadataLabelsType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_labels_type_0 = cast(list[str], data)

                return metadata_labels_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_labels_type_1 = PostApiTriggerSlackBodyFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = PostApiTriggerSlackBodyFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels"))

        def _parse_metadata_key(
            data: object,
        ) -> (
            list[str] | PostApiTriggerSlackBodyFiltersMetadataKeyType1 | PostApiTriggerSlackBodyFiltersMetadataKeyType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_key_type_0 = cast(list[str], data)

                return metadata_key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_key_type_1 = PostApiTriggerSlackBodyFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = PostApiTriggerSlackBodyFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key"))

        def _parse_metadata_value(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataValueType1
            | PostApiTriggerSlackBodyFiltersMetadataValueType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_value_type_0 = cast(list[str], data)

                return metadata_value_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_value_type_1 = PostApiTriggerSlackBodyFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = PostApiTriggerSlackBodyFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value"))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1
            | PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_prompt_ids_type_0 = cast(list[str], data)

                return metadata_prompt_ids_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_prompt_ids_type_1 = PostApiTriggerSlackBodyFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = PostApiTriggerSlackBodyFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids"))

        def _parse_traces_origin(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersTracesOriginType1
            | PostApiTriggerSlackBodyFiltersTracesOriginType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                traces_origin_type_0 = cast(list[str], data)

                return traces_origin_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                traces_origin_type_1 = PostApiTriggerSlackBodyFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = PostApiTriggerSlackBodyFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin"))

        def _parse_traces_error(
            data: object,
        ) -> (
            list[str] | PostApiTriggerSlackBodyFiltersTracesErrorType1 | PostApiTriggerSlackBodyFiltersTracesErrorType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                traces_error_type_0 = cast(list[str], data)

                return traces_error_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                traces_error_type_1 = PostApiTriggerSlackBodyFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = PostApiTriggerSlackBodyFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error"))

        def _parse_traces_name(
            data: object,
        ) -> list[str] | PostApiTriggerSlackBodyFiltersTracesNameType1 | PostApiTriggerSlackBodyFiltersTracesNameType2:
            try:
                if not isinstance(data, list):
                    raise TypeError()
                traces_name_type_0 = cast(list[str], data)

                return traces_name_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                traces_name_type_1 = PostApiTriggerSlackBodyFiltersTracesNameType1.from_dict(data)

                return traces_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_name_type_2 = PostApiTriggerSlackBodyFiltersTracesNameType2.from_dict(data)

            return traces_name_type_2

        traces_name = _parse_traces_name(d.pop("traces.name"))

        def _parse_spans_type(
            data: object,
        ) -> list[str] | PostApiTriggerSlackBodyFiltersSpansTypeType1 | PostApiTriggerSlackBodyFiltersSpansTypeType2:
            try:
                if not isinstance(data, list):
                    raise TypeError()
                spans_type_type_0 = cast(list[str], data)

                return spans_type_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                spans_type_type_1 = PostApiTriggerSlackBodyFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = PostApiTriggerSlackBodyFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type"))

        def _parse_spans_model(
            data: object,
        ) -> list[str] | PostApiTriggerSlackBodyFiltersSpansModelType1 | PostApiTriggerSlackBodyFiltersSpansModelType2:
            try:
                if not isinstance(data, list):
                    raise TypeError()
                spans_model_type_0 = cast(list[str], data)

                return spans_model_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                spans_model_type_1 = PostApiTriggerSlackBodyFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = PostApiTriggerSlackBodyFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model"))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_type_1 = PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType1.from_dict(
                    data
                )

                return evaluations_evaluator_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdType2.from_dict(data)

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id"))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_guardrails_only_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_guardrails_only_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_guardrails_only_type_1 = (
                    PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only")
        )

        def _parse_evaluations_evaluator_id_has_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_has_passed_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_has_passed_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_has_passed_type_1 = (
                    PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_passed_type_2 = (
                PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasPassedType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_passed_type_2

        evaluations_evaluator_id_has_passed = _parse_evaluations_evaluator_id_has_passed(
            d.pop("evaluations.evaluator_id.has_passed")
        )

        def _parse_evaluations_evaluator_id_has_score(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_has_score_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_has_score_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_has_score_type_1 = (
                    PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_score_type_2 = (
                PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasScoreType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_score_type_2

        evaluations_evaluator_id_has_score = _parse_evaluations_evaluator_id_has_score(
            d.pop("evaluations.evaluator_id.has_score")
        )

        def _parse_evaluations_evaluator_id_has_label(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1
            | PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_has_label_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_has_label_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_has_label_type_1 = (
                    PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_label_type_2 = (
                PostApiTriggerSlackBodyFiltersEvaluationsEvaluatorIdHasLabelType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_label_type_2

        evaluations_evaluator_id_has_label = _parse_evaluations_evaluator_id_has_label(
            d.pop("evaluations.evaluator_id.has_label")
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsPassedType1
            | PostApiTriggerSlackBodyFiltersEvaluationsPassedType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_passed_type_0 = cast(list[str], data)

                return evaluations_passed_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_passed_type_1 = PostApiTriggerSlackBodyFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = PostApiTriggerSlackBodyFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed"))

        def _parse_evaluations_score(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsScoreType1
            | PostApiTriggerSlackBodyFiltersEvaluationsScoreType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_score_type_0 = cast(list[str], data)

                return evaluations_score_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_score_type_1 = PostApiTriggerSlackBodyFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = PostApiTriggerSlackBodyFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score"))

        def _parse_evaluations_state(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsStateType1
            | PostApiTriggerSlackBodyFiltersEvaluationsStateType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_state_type_0 = cast(list[str], data)

                return evaluations_state_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_state_type_1 = PostApiTriggerSlackBodyFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = PostApiTriggerSlackBodyFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state"))

        def _parse_evaluations_label(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEvaluationsLabelType1
            | PostApiTriggerSlackBodyFiltersEvaluationsLabelType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_label_type_0 = cast(list[str], data)

                return evaluations_label_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_label_type_1 = PostApiTriggerSlackBodyFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = PostApiTriggerSlackBodyFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label"))

        def _parse_events_event_type(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEventsEventTypeType1
            | PostApiTriggerSlackBodyFiltersEventsEventTypeType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_event_type_type_0 = cast(list[str], data)

                return events_event_type_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_event_type_type_1 = PostApiTriggerSlackBodyFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = PostApiTriggerSlackBodyFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type"))

        def _parse_events_metrics_key(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1
            | PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_metrics_key_type_0 = cast(list[str], data)

                return events_metrics_key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_metrics_key_type_1 = PostApiTriggerSlackBodyFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = PostApiTriggerSlackBodyFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key"))

        def _parse_events_metrics_value(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEventsMetricsValueType1
            | PostApiTriggerSlackBodyFiltersEventsMetricsValueType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_metrics_value_type_0 = cast(list[str], data)

                return events_metrics_value_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_metrics_value_type_1 = PostApiTriggerSlackBodyFiltersEventsMetricsValueType1.from_dict(data)

                return events_metrics_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = PostApiTriggerSlackBodyFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value"))

        def _parse_events_event_details_key(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1
            | PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_event_details_key_type_0 = cast(list[str], data)

                return events_event_details_key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_event_details_key_type_1 = PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType1.from_dict(
                    data
                )

                return events_event_details_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = PostApiTriggerSlackBodyFiltersEventsEventDetailsKeyType2.from_dict(data)

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key"))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> (
            list[str]
            | PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1
            | PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2
        ):
            try:
                if not isinstance(data, list):
                    raise TypeError()
                annotations_has_annotation_type_0 = cast(list[str], data)

                return annotations_has_annotation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                annotations_has_annotation_type_1 = (
                    PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType1.from_dict(data)
                )

                return annotations_has_annotation_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = PostApiTriggerSlackBodyFiltersAnnotationsHasAnnotationType2.from_dict(
                data
            )

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation"))

        post_api_trigger_slack_body_filters = cls(
            topics_topics=topics_topics,
            topics_subtopics=topics_subtopics,
            metadata_user_id=metadata_user_id,
            metadata_thread_id=metadata_thread_id,
            metadata_customer_id=metadata_customer_id,
            metadata_labels=metadata_labels,
            metadata_key=metadata_key,
            metadata_value=metadata_value,
            metadata_prompt_ids=metadata_prompt_ids,
            traces_origin=traces_origin,
            traces_error=traces_error,
            traces_name=traces_name,
            spans_type=spans_type,
            spans_model=spans_model,
            evaluations_evaluator_id=evaluations_evaluator_id,
            evaluations_evaluator_id_guardrails_only=evaluations_evaluator_id_guardrails_only,
            evaluations_evaluator_id_has_passed=evaluations_evaluator_id_has_passed,
            evaluations_evaluator_id_has_score=evaluations_evaluator_id_has_score,
            evaluations_evaluator_id_has_label=evaluations_evaluator_id_has_label,
            evaluations_passed=evaluations_passed,
            evaluations_score=evaluations_score,
            evaluations_state=evaluations_state,
            evaluations_label=evaluations_label,
            events_event_type=events_event_type,
            events_metrics_key=events_metrics_key,
            events_metrics_value=events_metrics_value,
            events_event_details_key=events_event_details_key,
            annotations_has_annotation=annotations_has_annotation,
        )

        return post_api_trigger_slack_body_filters
