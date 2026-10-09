from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_analytics_body_series_item_filters_annotations_has_annotation_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_annotations_has_annotation_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_label_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_label_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_passed_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_passed_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_score_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_score_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_label_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_label_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_passed_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_passed_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_score_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_score_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_state_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_evaluations_state_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_event_details_key_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_event_details_key_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_event_type_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_event_type_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_metrics_key_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_metrics_key_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_metrics_value_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_events_metrics_value_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_customer_id_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_customer_id_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_key_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_key_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_labels_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_labels_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_prompt_ids_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_prompt_ids_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_thread_id_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_thread_id_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_user_id_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_user_id_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_value_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_metadata_value_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_spans_model_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersSpansModelType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_spans_model_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersSpansModelType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_spans_type_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_spans_type_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_topics_subtopics_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_topics_subtopics_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_topics_topics_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_topics_topics_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_error_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_error_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_name_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesNameType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_name_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesNameType2,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_origin_type_1 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1,
    )
    from ..models.post_api_analytics_body_series_item_filters_traces_origin_type_2 import (
        PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2,
    )


T = TypeVar("T", bound="PostApiAnalyticsBodySeriesItemFilters")


@_attrs_define
class PostApiAnalyticsBodySeriesItemFilters:
    """
    Attributes:
        topics_topics (list[str] | PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1 |
            PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2):
        topics_subtopics (list[str] | PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1 |
            PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2):
        metadata_user_id (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2):
        metadata_thread_id (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2):
        metadata_customer_id (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2):
        metadata_labels (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2):
        metadata_key (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2):
        metadata_value (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2):
        metadata_prompt_ids (list[str] | PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1 |
            PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2):
        traces_origin (list[str] | PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1 |
            PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2):
        traces_error (list[str] | PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1 |
            PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2):
        traces_name (list[str] | PostApiAnalyticsBodySeriesItemFiltersTracesNameType1 |
            PostApiAnalyticsBodySeriesItemFiltersTracesNameType2):
        spans_type (list[str] | PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1 |
            PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2):
        spans_model (list[str] | PostApiAnalyticsBodySeriesItemFiltersSpansModelType1 |
            PostApiAnalyticsBodySeriesItemFiltersSpansModelType2):
        evaluations_evaluator_id (list[str] | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2):
        evaluations_evaluator_id_guardrails_only (list[str] |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2):
        evaluations_evaluator_id_has_passed (list[str] |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2):
        evaluations_evaluator_id_has_score (list[str] |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2):
        evaluations_evaluator_id_has_label (list[str] |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2):
        evaluations_passed (list[str] | PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2):
        evaluations_score (list[str] | PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2):
        evaluations_state (list[str] | PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2):
        evaluations_label (list[str] | PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1 |
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2):
        events_event_type (list[str] | PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1 |
            PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2):
        events_metrics_key (list[str] | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1 |
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2):
        events_metrics_value (list[str] | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1 |
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2):
        events_event_details_key (list[str] | PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1 |
            PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2):
        annotations_has_annotation (list[str] | PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1 |
            PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2):
    """

    topics_topics: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1
        | PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2
    )
    topics_subtopics: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1
        | PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2
    )
    metadata_user_id: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2
    )
    metadata_thread_id: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2
    )
    metadata_customer_id: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2
    )
    metadata_labels: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2
    )
    metadata_key: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2
    )
    metadata_value: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2
    )
    metadata_prompt_ids: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1
        | PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2
    )
    traces_origin: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1
        | PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2
    )
    traces_error: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1
        | PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2
    )
    traces_name: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersTracesNameType1
        | PostApiAnalyticsBodySeriesItemFiltersTracesNameType2
    )
    spans_type: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1
        | PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2
    )
    spans_model: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersSpansModelType1
        | PostApiAnalyticsBodySeriesItemFiltersSpansModelType2
    )
    evaluations_evaluator_id: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2
    )
    evaluations_evaluator_id_guardrails_only: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
    )
    evaluations_evaluator_id_has_passed: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2
    )
    evaluations_evaluator_id_has_score: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2
    )
    evaluations_evaluator_id_has_label: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2
    )
    evaluations_passed: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2
    )
    evaluations_score: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2
    )
    evaluations_state: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2
    )
    evaluations_label: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1
        | PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2
    )
    events_event_type: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1
        | PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2
    )
    events_metrics_key: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1
        | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2
    )
    events_metrics_value: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1
        | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2
    )
    events_event_details_key: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1
        | PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2
    )
    annotations_has_annotation: (
        list[str]
        | PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1
        | PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_analytics_body_series_item_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_label_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_score_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_state_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_type_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_labels_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_value_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_model_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_type_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_topics_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_error_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_name_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesNameType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_origin_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1,
        )

        topics_topics: dict[str, Any] | list[str]
        if isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: dict[str, Any] | list[str]
        if isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: dict[str, Any] | list[str]
        if isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: dict[str, Any] | list[str]
        if isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: dict[str, Any] | list[str]
        if isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: dict[str, Any] | list[str]
        if isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: dict[str, Any] | list[str]
        if isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: dict[str, Any] | list[str]
        if isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        traces_name: dict[str, Any] | list[str]
        if isinstance(self.traces_name, list):
            traces_name = self.traces_name

        elif isinstance(self.traces_name, PostApiAnalyticsBodySeriesItemFiltersTracesNameType1):
            traces_name = self.traces_name.to_dict()
        else:
            traces_name = self.traces_name.to_dict()

        spans_type: dict[str, Any] | list[str]
        if isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: dict[str, Any] | list[str]
        if isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, PostApiAnalyticsBodySeriesItemFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(
            self.evaluations_evaluator_id, PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1
        ):
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()
        else:
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()

        evaluations_evaluator_id_guardrails_only: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_guardrails_only, list):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only

        elif isinstance(
            self.evaluations_evaluator_id_guardrails_only,
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_evaluator_id_has_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_passed, list):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed

        elif isinstance(
            self.evaluations_evaluator_id_has_passed,
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1,
        ):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()
        else:
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()

        evaluations_evaluator_id_has_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_score, list):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score

        elif isinstance(
            self.evaluations_evaluator_id_has_score,
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1,
        ):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()
        else:
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()

        evaluations_evaluator_id_has_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_label, list):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label

        elif isinstance(
            self.evaluations_evaluator_id_has_label,
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1,
        ):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()
        else:
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()

        evaluations_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: dict[str, Any] | list[str]
        if isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: dict[str, Any] | list[str]
        if isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: dict[str, Any] | list[str]
        if isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: dict[str, Any] | list[str]
        if isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(
            self.annotations_has_annotation, PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1
        ):
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
        from ..models.post_api_analytics_body_series_item_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_annotations_has_annotation_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_label_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_passed_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_has_score_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_evaluator_id_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_label_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_label_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_passed_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_score_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_score_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_state_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_evaluations_state_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_details_key_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_type_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_event_type_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_key_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_events_metrics_value_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_customer_id_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_key_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_key_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_labels_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_labels_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_prompt_ids_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_thread_id_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_user_id_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_value_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_metadata_value_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_model_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_model_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansModelType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_type_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_spans_type_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_subtopics_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_topics_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_topics_topics_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_error_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_error_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_name_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesNameType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_name_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesNameType2,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_origin_type_1 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1,
        )
        from ..models.post_api_analytics_body_series_item_filters_traces_origin_type_2 import (
            PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2,
        )

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1
            | PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2
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
                topics_topics_type_1 = PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = PostApiAnalyticsBodySeriesItemFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics"))

        def _parse_topics_subtopics(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1
            | PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2
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
                topics_subtopics_type_1 = PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = PostApiAnalyticsBodySeriesItemFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics"))

        def _parse_metadata_user_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2
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
                metadata_user_id_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id"))

        def _parse_metadata_thread_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2
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
                metadata_thread_id_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id"))

        def _parse_metadata_customer_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2
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
                metadata_customer_id_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType1.from_dict(
                    data
                )

                return metadata_customer_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id"))

        def _parse_metadata_labels(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2
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
                metadata_labels_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels"))

        def _parse_metadata_key(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2
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
                metadata_key_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key"))

        def _parse_metadata_value(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2
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
                metadata_value_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value"))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1
            | PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2
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
                metadata_prompt_ids_type_1 = PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = PostApiAnalyticsBodySeriesItemFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids"))

        def _parse_traces_origin(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1
            | PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2
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
                traces_origin_type_1 = PostApiAnalyticsBodySeriesItemFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = PostApiAnalyticsBodySeriesItemFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin"))

        def _parse_traces_error(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1
            | PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2
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
                traces_error_type_1 = PostApiAnalyticsBodySeriesItemFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = PostApiAnalyticsBodySeriesItemFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error"))

        def _parse_traces_name(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersTracesNameType1
            | PostApiAnalyticsBodySeriesItemFiltersTracesNameType2
        ):
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
                traces_name_type_1 = PostApiAnalyticsBodySeriesItemFiltersTracesNameType1.from_dict(data)

                return traces_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_name_type_2 = PostApiAnalyticsBodySeriesItemFiltersTracesNameType2.from_dict(data)

            return traces_name_type_2

        traces_name = _parse_traces_name(d.pop("traces.name"))

        def _parse_spans_type(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1
            | PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2
        ):
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
                spans_type_type_1 = PostApiAnalyticsBodySeriesItemFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = PostApiAnalyticsBodySeriesItemFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type"))

        def _parse_spans_model(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersSpansModelType1
            | PostApiAnalyticsBodySeriesItemFiltersSpansModelType2
        ):
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
                spans_model_type_1 = PostApiAnalyticsBodySeriesItemFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = PostApiAnalyticsBodySeriesItemFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model"))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2
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
                evaluations_evaluator_id_type_1 = (
                    PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType1.from_dict(data)
                )

                return evaluations_evaluator_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdType2.from_dict(data)
            )

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id"))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
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
                    PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only")
        )

        def _parse_evaluations_evaluator_id_has_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2
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
                    PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_passed_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasPassedType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_passed_type_2

        evaluations_evaluator_id_has_passed = _parse_evaluations_evaluator_id_has_passed(
            d.pop("evaluations.evaluator_id.has_passed")
        )

        def _parse_evaluations_evaluator_id_has_score(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2
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
                    PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_score_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasScoreType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_score_type_2

        evaluations_evaluator_id_has_score = _parse_evaluations_evaluator_id_has_score(
            d.pop("evaluations.evaluator_id.has_score")
        )

        def _parse_evaluations_evaluator_id_has_label(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2
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
                    PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_label_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersEvaluationsEvaluatorIdHasLabelType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_label_type_2

        evaluations_evaluator_id_has_label = _parse_evaluations_evaluator_id_has_label(
            d.pop("evaluations.evaluator_id.has_label")
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2
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
                evaluations_passed_type_1 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed"))

        def _parse_evaluations_score(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2
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
                evaluations_score_type_1 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score"))

        def _parse_evaluations_state(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2
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
                evaluations_state_type_1 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state"))

        def _parse_evaluations_label(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1
            | PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2
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
                evaluations_label_type_1 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = PostApiAnalyticsBodySeriesItemFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label"))

        def _parse_events_event_type(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1
            | PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2
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
                events_event_type_type_1 = PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = PostApiAnalyticsBodySeriesItemFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type"))

        def _parse_events_metrics_key(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1
            | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2
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
                events_metrics_key_type_1 = PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = PostApiAnalyticsBodySeriesItemFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key"))

        def _parse_events_metrics_value(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1
            | PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2
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
                events_metrics_value_type_1 = PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType1.from_dict(
                    data
                )

                return events_metrics_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = PostApiAnalyticsBodySeriesItemFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value"))

        def _parse_events_event_details_key(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1
            | PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2
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
                events_event_details_key_type_1 = (
                    PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType1.from_dict(data)
                )

                return events_event_details_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = PostApiAnalyticsBodySeriesItemFiltersEventsEventDetailsKeyType2.from_dict(
                data
            )

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key"))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1
            | PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2
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
                    PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType1.from_dict(data)
                )

                return annotations_has_annotation_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = (
                PostApiAnalyticsBodySeriesItemFiltersAnnotationsHasAnnotationType2.from_dict(data)
            )

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation"))

        post_api_analytics_body_series_item_filters = cls(
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

        return post_api_analytics_body_series_item_filters
