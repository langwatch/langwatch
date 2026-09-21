from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_api_analytics_body_filters_annotations_has_annotation_type_1 import (
        PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.post_api_analytics_body_filters_annotations_has_annotation_type_2 import (
        PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_label_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_label_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_passed_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_score_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_score_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_label_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsLabelType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_label_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsLabelType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_passed_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsPassedType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_passed_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsPassedType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_score_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsScoreType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_score_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsScoreType2,
    )
    from ..models.post_api_analytics_body_filters_evaluations_state_type_1 import (
        PostApiAnalyticsBodyFiltersEvaluationsStateType1,
    )
    from ..models.post_api_analytics_body_filters_evaluations_state_type_2 import (
        PostApiAnalyticsBodyFiltersEvaluationsStateType2,
    )
    from ..models.post_api_analytics_body_filters_events_event_details_key_type_1 import (
        PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1,
    )
    from ..models.post_api_analytics_body_filters_events_event_details_key_type_2 import (
        PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2,
    )
    from ..models.post_api_analytics_body_filters_events_event_type_type_1 import (
        PostApiAnalyticsBodyFiltersEventsEventTypeType1,
    )
    from ..models.post_api_analytics_body_filters_events_event_type_type_2 import (
        PostApiAnalyticsBodyFiltersEventsEventTypeType2,
    )
    from ..models.post_api_analytics_body_filters_events_metrics_key_type_1 import (
        PostApiAnalyticsBodyFiltersEventsMetricsKeyType1,
    )
    from ..models.post_api_analytics_body_filters_events_metrics_key_type_2 import (
        PostApiAnalyticsBodyFiltersEventsMetricsKeyType2,
    )
    from ..models.post_api_analytics_body_filters_events_metrics_value_type_1 import (
        PostApiAnalyticsBodyFiltersEventsMetricsValueType1,
    )
    from ..models.post_api_analytics_body_filters_events_metrics_value_type_2 import (
        PostApiAnalyticsBodyFiltersEventsMetricsValueType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_customer_id_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataCustomerIdType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_customer_id_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataCustomerIdType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_key_type_1 import PostApiAnalyticsBodyFiltersMetadataKeyType1
    from ..models.post_api_analytics_body_filters_metadata_key_type_2 import PostApiAnalyticsBodyFiltersMetadataKeyType2
    from ..models.post_api_analytics_body_filters_metadata_labels_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataLabelsType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_labels_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataLabelsType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_prompt_ids_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataPromptIdsType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_prompt_ids_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataPromptIdsType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_thread_id_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataThreadIdType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_thread_id_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataThreadIdType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_user_id_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataUserIdType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_user_id_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataUserIdType2,
    )
    from ..models.post_api_analytics_body_filters_metadata_value_type_1 import (
        PostApiAnalyticsBodyFiltersMetadataValueType1,
    )
    from ..models.post_api_analytics_body_filters_metadata_value_type_2 import (
        PostApiAnalyticsBodyFiltersMetadataValueType2,
    )
    from ..models.post_api_analytics_body_filters_spans_model_type_1 import PostApiAnalyticsBodyFiltersSpansModelType1
    from ..models.post_api_analytics_body_filters_spans_model_type_2 import PostApiAnalyticsBodyFiltersSpansModelType2
    from ..models.post_api_analytics_body_filters_spans_type_type_1 import PostApiAnalyticsBodyFiltersSpansTypeType1
    from ..models.post_api_analytics_body_filters_spans_type_type_2 import PostApiAnalyticsBodyFiltersSpansTypeType2
    from ..models.post_api_analytics_body_filters_topics_subtopics_type_1 import (
        PostApiAnalyticsBodyFiltersTopicsSubtopicsType1,
    )
    from ..models.post_api_analytics_body_filters_topics_subtopics_type_2 import (
        PostApiAnalyticsBodyFiltersTopicsSubtopicsType2,
    )
    from ..models.post_api_analytics_body_filters_topics_topics_type_1 import (
        PostApiAnalyticsBodyFiltersTopicsTopicsType1,
    )
    from ..models.post_api_analytics_body_filters_topics_topics_type_2 import (
        PostApiAnalyticsBodyFiltersTopicsTopicsType2,
    )
    from ..models.post_api_analytics_body_filters_traces_error_type_1 import PostApiAnalyticsBodyFiltersTracesErrorType1
    from ..models.post_api_analytics_body_filters_traces_error_type_2 import PostApiAnalyticsBodyFiltersTracesErrorType2
    from ..models.post_api_analytics_body_filters_traces_name_type_1 import PostApiAnalyticsBodyFiltersTracesNameType1
    from ..models.post_api_analytics_body_filters_traces_name_type_2 import PostApiAnalyticsBodyFiltersTracesNameType2
    from ..models.post_api_analytics_body_filters_traces_origin_type_1 import (
        PostApiAnalyticsBodyFiltersTracesOriginType1,
    )
    from ..models.post_api_analytics_body_filters_traces_origin_type_2 import (
        PostApiAnalyticsBodyFiltersTracesOriginType2,
    )


T = TypeVar("T", bound="PostApiAnalyticsBodyFilters")


@_attrs_define
class PostApiAnalyticsBodyFilters:
    """
    Attributes:
        topics_topics (list[str] | PostApiAnalyticsBodyFiltersTopicsTopicsType1 |
            PostApiAnalyticsBodyFiltersTopicsTopicsType2):
        topics_subtopics (list[str] | PostApiAnalyticsBodyFiltersTopicsSubtopicsType1 |
            PostApiAnalyticsBodyFiltersTopicsSubtopicsType2):
        metadata_user_id (list[str] | PostApiAnalyticsBodyFiltersMetadataUserIdType1 |
            PostApiAnalyticsBodyFiltersMetadataUserIdType2):
        metadata_thread_id (list[str] | PostApiAnalyticsBodyFiltersMetadataThreadIdType1 |
            PostApiAnalyticsBodyFiltersMetadataThreadIdType2):
        metadata_customer_id (list[str] | PostApiAnalyticsBodyFiltersMetadataCustomerIdType1 |
            PostApiAnalyticsBodyFiltersMetadataCustomerIdType2):
        metadata_labels (list[str] | PostApiAnalyticsBodyFiltersMetadataLabelsType1 |
            PostApiAnalyticsBodyFiltersMetadataLabelsType2):
        metadata_key (list[str] | PostApiAnalyticsBodyFiltersMetadataKeyType1 |
            PostApiAnalyticsBodyFiltersMetadataKeyType2):
        metadata_value (list[str] | PostApiAnalyticsBodyFiltersMetadataValueType1 |
            PostApiAnalyticsBodyFiltersMetadataValueType2):
        metadata_prompt_ids (list[str] | PostApiAnalyticsBodyFiltersMetadataPromptIdsType1 |
            PostApiAnalyticsBodyFiltersMetadataPromptIdsType2):
        traces_origin (list[str] | PostApiAnalyticsBodyFiltersTracesOriginType1 |
            PostApiAnalyticsBodyFiltersTracesOriginType2):
        traces_error (list[str] | PostApiAnalyticsBodyFiltersTracesErrorType1 |
            PostApiAnalyticsBodyFiltersTracesErrorType2):
        traces_name (list[str] | PostApiAnalyticsBodyFiltersTracesNameType1 |
            PostApiAnalyticsBodyFiltersTracesNameType2):
        spans_type (list[str] | PostApiAnalyticsBodyFiltersSpansTypeType1 | PostApiAnalyticsBodyFiltersSpansTypeType2):
        spans_model (list[str] | PostApiAnalyticsBodyFiltersSpansModelType1 |
            PostApiAnalyticsBodyFiltersSpansModelType2):
        evaluations_evaluator_id (list[str] | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1 |
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2):
        evaluations_evaluator_id_guardrails_only (list[str] |
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1 |
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2):
        evaluations_evaluator_id_has_passed (list[str] | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2):
        evaluations_evaluator_id_has_score (list[str] | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1 |
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2):
        evaluations_evaluator_id_has_label (list[str] | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1 |
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2):
        evaluations_passed (list[str] | PostApiAnalyticsBodyFiltersEvaluationsPassedType1 |
            PostApiAnalyticsBodyFiltersEvaluationsPassedType2):
        evaluations_score (list[str] | PostApiAnalyticsBodyFiltersEvaluationsScoreType1 |
            PostApiAnalyticsBodyFiltersEvaluationsScoreType2):
        evaluations_state (list[str] | PostApiAnalyticsBodyFiltersEvaluationsStateType1 |
            PostApiAnalyticsBodyFiltersEvaluationsStateType2):
        evaluations_label (list[str] | PostApiAnalyticsBodyFiltersEvaluationsLabelType1 |
            PostApiAnalyticsBodyFiltersEvaluationsLabelType2):
        events_event_type (list[str] | PostApiAnalyticsBodyFiltersEventsEventTypeType1 |
            PostApiAnalyticsBodyFiltersEventsEventTypeType2):
        events_metrics_key (list[str] | PostApiAnalyticsBodyFiltersEventsMetricsKeyType1 |
            PostApiAnalyticsBodyFiltersEventsMetricsKeyType2):
        events_metrics_value (list[str] | PostApiAnalyticsBodyFiltersEventsMetricsValueType1 |
            PostApiAnalyticsBodyFiltersEventsMetricsValueType2):
        events_event_details_key (list[str] | PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1 |
            PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2):
        annotations_has_annotation (list[str] | PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1 |
            PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2):
    """

    topics_topics: (
        list[str] | PostApiAnalyticsBodyFiltersTopicsTopicsType1 | PostApiAnalyticsBodyFiltersTopicsTopicsType2
    )
    topics_subtopics: (
        list[str] | PostApiAnalyticsBodyFiltersTopicsSubtopicsType1 | PostApiAnalyticsBodyFiltersTopicsSubtopicsType2
    )
    metadata_user_id: (
        list[str] | PostApiAnalyticsBodyFiltersMetadataUserIdType1 | PostApiAnalyticsBodyFiltersMetadataUserIdType2
    )
    metadata_thread_id: (
        list[str] | PostApiAnalyticsBodyFiltersMetadataThreadIdType1 | PostApiAnalyticsBodyFiltersMetadataThreadIdType2
    )
    metadata_customer_id: (
        list[str]
        | PostApiAnalyticsBodyFiltersMetadataCustomerIdType1
        | PostApiAnalyticsBodyFiltersMetadataCustomerIdType2
    )
    metadata_labels: (
        list[str] | PostApiAnalyticsBodyFiltersMetadataLabelsType1 | PostApiAnalyticsBodyFiltersMetadataLabelsType2
    )
    metadata_key: list[str] | PostApiAnalyticsBodyFiltersMetadataKeyType1 | PostApiAnalyticsBodyFiltersMetadataKeyType2
    metadata_value: (
        list[str] | PostApiAnalyticsBodyFiltersMetadataValueType1 | PostApiAnalyticsBodyFiltersMetadataValueType2
    )
    metadata_prompt_ids: (
        list[str]
        | PostApiAnalyticsBodyFiltersMetadataPromptIdsType1
        | PostApiAnalyticsBodyFiltersMetadataPromptIdsType2
    )
    traces_origin: (
        list[str] | PostApiAnalyticsBodyFiltersTracesOriginType1 | PostApiAnalyticsBodyFiltersTracesOriginType2
    )
    traces_error: list[str] | PostApiAnalyticsBodyFiltersTracesErrorType1 | PostApiAnalyticsBodyFiltersTracesErrorType2
    traces_name: list[str] | PostApiAnalyticsBodyFiltersTracesNameType1 | PostApiAnalyticsBodyFiltersTracesNameType2
    spans_type: list[str] | PostApiAnalyticsBodyFiltersSpansTypeType1 | PostApiAnalyticsBodyFiltersSpansTypeType2
    spans_model: list[str] | PostApiAnalyticsBodyFiltersSpansModelType1 | PostApiAnalyticsBodyFiltersSpansModelType2
    evaluations_evaluator_id: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2
    )
    evaluations_evaluator_id_guardrails_only: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
    )
    evaluations_evaluator_id_has_passed: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2
    )
    evaluations_evaluator_id_has_score: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2
    )
    evaluations_evaluator_id_has_label: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1
        | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2
    )
    evaluations_passed: (
        list[str]
        | PostApiAnalyticsBodyFiltersEvaluationsPassedType1
        | PostApiAnalyticsBodyFiltersEvaluationsPassedType2
    )
    evaluations_score: (
        list[str] | PostApiAnalyticsBodyFiltersEvaluationsScoreType1 | PostApiAnalyticsBodyFiltersEvaluationsScoreType2
    )
    evaluations_state: (
        list[str] | PostApiAnalyticsBodyFiltersEvaluationsStateType1 | PostApiAnalyticsBodyFiltersEvaluationsStateType2
    )
    evaluations_label: (
        list[str] | PostApiAnalyticsBodyFiltersEvaluationsLabelType1 | PostApiAnalyticsBodyFiltersEvaluationsLabelType2
    )
    events_event_type: (
        list[str] | PostApiAnalyticsBodyFiltersEventsEventTypeType1 | PostApiAnalyticsBodyFiltersEventsEventTypeType2
    )
    events_metrics_key: (
        list[str] | PostApiAnalyticsBodyFiltersEventsMetricsKeyType1 | PostApiAnalyticsBodyFiltersEventsMetricsKeyType2
    )
    events_metrics_value: (
        list[str]
        | PostApiAnalyticsBodyFiltersEventsMetricsValueType1
        | PostApiAnalyticsBodyFiltersEventsMetricsValueType2
    )
    events_event_details_key: (
        list[str]
        | PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1
        | PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2
    )
    annotations_has_annotation: (
        list[str]
        | PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1
        | PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_analytics_body_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_label_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_score_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_state_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_body_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_body_filters_events_event_type_type_1 import (
            PostApiAnalyticsBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_key_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_labels_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_value_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_body_filters_spans_model_type_1 import (
            PostApiAnalyticsBodyFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_body_filters_spans_type_type_1 import PostApiAnalyticsBodyFiltersSpansTypeType1
        from ..models.post_api_analytics_body_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_body_filters_topics_topics_type_1 import (
            PostApiAnalyticsBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_body_filters_traces_error_type_1 import (
            PostApiAnalyticsBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_body_filters_traces_name_type_1 import (
            PostApiAnalyticsBodyFiltersTracesNameType1,
        )
        from ..models.post_api_analytics_body_filters_traces_origin_type_1 import (
            PostApiAnalyticsBodyFiltersTracesOriginType1,
        )

        topics_topics: dict[str, Any] | list[str]
        if isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, PostApiAnalyticsBodyFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: dict[str, Any] | list[str]
        if isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, PostApiAnalyticsBodyFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, PostApiAnalyticsBodyFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, PostApiAnalyticsBodyFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: dict[str, Any] | list[str]
        if isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, PostApiAnalyticsBodyFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: dict[str, Any] | list[str]
        if isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, PostApiAnalyticsBodyFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: dict[str, Any] | list[str]
        if isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, PostApiAnalyticsBodyFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: dict[str, Any] | list[str]
        if isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, PostApiAnalyticsBodyFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: dict[str, Any] | list[str]
        if isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, PostApiAnalyticsBodyFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: dict[str, Any] | list[str]
        if isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, PostApiAnalyticsBodyFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: dict[str, Any] | list[str]
        if isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, PostApiAnalyticsBodyFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        traces_name: dict[str, Any] | list[str]
        if isinstance(self.traces_name, list):
            traces_name = self.traces_name

        elif isinstance(self.traces_name, PostApiAnalyticsBodyFiltersTracesNameType1):
            traces_name = self.traces_name.to_dict()
        else:
            traces_name = self.traces_name.to_dict()

        spans_type: dict[str, Any] | list[str]
        if isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, PostApiAnalyticsBodyFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: dict[str, Any] | list[str]
        if isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, PostApiAnalyticsBodyFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(self.evaluations_evaluator_id, PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1):
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()
        else:
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()

        evaluations_evaluator_id_guardrails_only: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_guardrails_only, list):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only

        elif isinstance(
            self.evaluations_evaluator_id_guardrails_only,
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_evaluator_id_has_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_passed, list):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed

        elif isinstance(
            self.evaluations_evaluator_id_has_passed, PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1
        ):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()
        else:
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()

        evaluations_evaluator_id_has_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_score, list):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score

        elif isinstance(
            self.evaluations_evaluator_id_has_score, PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1
        ):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()
        else:
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()

        evaluations_evaluator_id_has_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_evaluator_id_has_label, list):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label

        elif isinstance(
            self.evaluations_evaluator_id_has_label, PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1
        ):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()
        else:
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()

        evaluations_passed: dict[str, Any] | list[str]
        if isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, PostApiAnalyticsBodyFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: dict[str, Any] | list[str]
        if isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, PostApiAnalyticsBodyFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: dict[str, Any] | list[str]
        if isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, PostApiAnalyticsBodyFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: dict[str, Any] | list[str]
        if isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, PostApiAnalyticsBodyFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: dict[str, Any] | list[str]
        if isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, PostApiAnalyticsBodyFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, PostApiAnalyticsBodyFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: dict[str, Any] | list[str]
        if isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, PostApiAnalyticsBodyFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: dict[str, Any] | list[str]
        if isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: dict[str, Any] | list[str]
        if isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(self.annotations_has_annotation, PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1):
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
        from ..models.post_api_analytics_body_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_body_filters_annotations_has_annotation_type_2 import (
            PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_label_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_label_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_passed_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_passed_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_score_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_has_score_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_evaluator_id_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_label_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_label_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsLabelType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_passed_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsPassedType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_score_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_score_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsScoreType2,
        )
        from ..models.post_api_analytics_body_filters_evaluations_state_type_1 import (
            PostApiAnalyticsBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_body_filters_evaluations_state_type_2 import (
            PostApiAnalyticsBodyFiltersEvaluationsStateType2,
        )
        from ..models.post_api_analytics_body_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_body_filters_events_event_details_key_type_2 import (
            PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2,
        )
        from ..models.post_api_analytics_body_filters_events_event_type_type_1 import (
            PostApiAnalyticsBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_body_filters_events_event_type_type_2 import (
            PostApiAnalyticsBodyFiltersEventsEventTypeType2,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_key_type_2 import (
            PostApiAnalyticsBodyFiltersEventsMetricsKeyType2,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_body_filters_events_metrics_value_type_2 import (
            PostApiAnalyticsBodyFiltersEventsMetricsValueType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_customer_id_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataCustomerIdType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_key_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_key_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataKeyType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_labels_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_labels_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataLabelsType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_prompt_ids_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataPromptIdsType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_thread_id_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataThreadIdType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_user_id_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataUserIdType2,
        )
        from ..models.post_api_analytics_body_filters_metadata_value_type_1 import (
            PostApiAnalyticsBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_body_filters_metadata_value_type_2 import (
            PostApiAnalyticsBodyFiltersMetadataValueType2,
        )
        from ..models.post_api_analytics_body_filters_spans_model_type_1 import (
            PostApiAnalyticsBodyFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_body_filters_spans_model_type_2 import (
            PostApiAnalyticsBodyFiltersSpansModelType2,
        )
        from ..models.post_api_analytics_body_filters_spans_type_type_1 import PostApiAnalyticsBodyFiltersSpansTypeType1
        from ..models.post_api_analytics_body_filters_spans_type_type_2 import PostApiAnalyticsBodyFiltersSpansTypeType2
        from ..models.post_api_analytics_body_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_body_filters_topics_subtopics_type_2 import (
            PostApiAnalyticsBodyFiltersTopicsSubtopicsType2,
        )
        from ..models.post_api_analytics_body_filters_topics_topics_type_1 import (
            PostApiAnalyticsBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_body_filters_topics_topics_type_2 import (
            PostApiAnalyticsBodyFiltersTopicsTopicsType2,
        )
        from ..models.post_api_analytics_body_filters_traces_error_type_1 import (
            PostApiAnalyticsBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_body_filters_traces_error_type_2 import (
            PostApiAnalyticsBodyFiltersTracesErrorType2,
        )
        from ..models.post_api_analytics_body_filters_traces_name_type_1 import (
            PostApiAnalyticsBodyFiltersTracesNameType1,
        )
        from ..models.post_api_analytics_body_filters_traces_name_type_2 import (
            PostApiAnalyticsBodyFiltersTracesNameType2,
        )
        from ..models.post_api_analytics_body_filters_traces_origin_type_1 import (
            PostApiAnalyticsBodyFiltersTracesOriginType1,
        )
        from ..models.post_api_analytics_body_filters_traces_origin_type_2 import (
            PostApiAnalyticsBodyFiltersTracesOriginType2,
        )

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersTopicsTopicsType1 | PostApiAnalyticsBodyFiltersTopicsTopicsType2:
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
                topics_topics_type_1 = PostApiAnalyticsBodyFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = PostApiAnalyticsBodyFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics"))

        def _parse_topics_subtopics(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersTopicsSubtopicsType1
            | PostApiAnalyticsBodyFiltersTopicsSubtopicsType2
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
                topics_subtopics_type_1 = PostApiAnalyticsBodyFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = PostApiAnalyticsBodyFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics"))

        def _parse_metadata_user_id(
            data: object,
        ) -> (
            list[str] | PostApiAnalyticsBodyFiltersMetadataUserIdType1 | PostApiAnalyticsBodyFiltersMetadataUserIdType2
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
                metadata_user_id_type_1 = PostApiAnalyticsBodyFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = PostApiAnalyticsBodyFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id"))

        def _parse_metadata_thread_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersMetadataThreadIdType1
            | PostApiAnalyticsBodyFiltersMetadataThreadIdType2
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
                metadata_thread_id_type_1 = PostApiAnalyticsBodyFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = PostApiAnalyticsBodyFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id"))

        def _parse_metadata_customer_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersMetadataCustomerIdType1
            | PostApiAnalyticsBodyFiltersMetadataCustomerIdType2
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
                metadata_customer_id_type_1 = PostApiAnalyticsBodyFiltersMetadataCustomerIdType1.from_dict(data)

                return metadata_customer_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = PostApiAnalyticsBodyFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id"))

        def _parse_metadata_labels(
            data: object,
        ) -> (
            list[str] | PostApiAnalyticsBodyFiltersMetadataLabelsType1 | PostApiAnalyticsBodyFiltersMetadataLabelsType2
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
                metadata_labels_type_1 = PostApiAnalyticsBodyFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = PostApiAnalyticsBodyFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels"))

        def _parse_metadata_key(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersMetadataKeyType1 | PostApiAnalyticsBodyFiltersMetadataKeyType2:
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
                metadata_key_type_1 = PostApiAnalyticsBodyFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = PostApiAnalyticsBodyFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key"))

        def _parse_metadata_value(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersMetadataValueType1 | PostApiAnalyticsBodyFiltersMetadataValueType2:
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
                metadata_value_type_1 = PostApiAnalyticsBodyFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = PostApiAnalyticsBodyFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value"))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersMetadataPromptIdsType1
            | PostApiAnalyticsBodyFiltersMetadataPromptIdsType2
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
                metadata_prompt_ids_type_1 = PostApiAnalyticsBodyFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = PostApiAnalyticsBodyFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids"))

        def _parse_traces_origin(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersTracesOriginType1 | PostApiAnalyticsBodyFiltersTracesOriginType2:
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
                traces_origin_type_1 = PostApiAnalyticsBodyFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = PostApiAnalyticsBodyFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin"))

        def _parse_traces_error(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersTracesErrorType1 | PostApiAnalyticsBodyFiltersTracesErrorType2:
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
                traces_error_type_1 = PostApiAnalyticsBodyFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = PostApiAnalyticsBodyFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error"))

        def _parse_traces_name(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersTracesNameType1 | PostApiAnalyticsBodyFiltersTracesNameType2:
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
                traces_name_type_1 = PostApiAnalyticsBodyFiltersTracesNameType1.from_dict(data)

                return traces_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_name_type_2 = PostApiAnalyticsBodyFiltersTracesNameType2.from_dict(data)

            return traces_name_type_2

        traces_name = _parse_traces_name(d.pop("traces.name"))

        def _parse_spans_type(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersSpansTypeType1 | PostApiAnalyticsBodyFiltersSpansTypeType2:
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
                spans_type_type_1 = PostApiAnalyticsBodyFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = PostApiAnalyticsBodyFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type"))

        def _parse_spans_model(
            data: object,
        ) -> list[str] | PostApiAnalyticsBodyFiltersSpansModelType1 | PostApiAnalyticsBodyFiltersSpansModelType2:
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
                spans_model_type_1 = PostApiAnalyticsBodyFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = PostApiAnalyticsBodyFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model"))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2
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
                evaluations_evaluator_id_type_1 = PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType1.from_dict(data)

                return evaluations_evaluator_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdType2.from_dict(data)

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id"))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
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
                    PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only")
        )

        def _parse_evaluations_evaluator_id_has_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2
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
                    PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_passed_type_2 = (
                PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasPassedType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_passed_type_2

        evaluations_evaluator_id_has_passed = _parse_evaluations_evaluator_id_has_passed(
            d.pop("evaluations.evaluator_id.has_passed")
        )

        def _parse_evaluations_evaluator_id_has_score(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2
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
                    PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_score_type_2 = (
                PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasScoreType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_score_type_2

        evaluations_evaluator_id_has_score = _parse_evaluations_evaluator_id_has_score(
            d.pop("evaluations.evaluator_id.has_score")
        )

        def _parse_evaluations_evaluator_id_has_label(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1
            | PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2
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
                    PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_label_type_2 = (
                PostApiAnalyticsBodyFiltersEvaluationsEvaluatorIdHasLabelType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_label_type_2

        evaluations_evaluator_id_has_label = _parse_evaluations_evaluator_id_has_label(
            d.pop("evaluations.evaluator_id.has_label")
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsPassedType1
            | PostApiAnalyticsBodyFiltersEvaluationsPassedType2
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
                evaluations_passed_type_1 = PostApiAnalyticsBodyFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = PostApiAnalyticsBodyFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed"))

        def _parse_evaluations_score(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsScoreType1
            | PostApiAnalyticsBodyFiltersEvaluationsScoreType2
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
                evaluations_score_type_1 = PostApiAnalyticsBodyFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = PostApiAnalyticsBodyFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score"))

        def _parse_evaluations_state(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsStateType1
            | PostApiAnalyticsBodyFiltersEvaluationsStateType2
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
                evaluations_state_type_1 = PostApiAnalyticsBodyFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = PostApiAnalyticsBodyFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state"))

        def _parse_evaluations_label(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEvaluationsLabelType1
            | PostApiAnalyticsBodyFiltersEvaluationsLabelType2
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
                evaluations_label_type_1 = PostApiAnalyticsBodyFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = PostApiAnalyticsBodyFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label"))

        def _parse_events_event_type(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEventsEventTypeType1
            | PostApiAnalyticsBodyFiltersEventsEventTypeType2
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
                events_event_type_type_1 = PostApiAnalyticsBodyFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = PostApiAnalyticsBodyFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type"))

        def _parse_events_metrics_key(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEventsMetricsKeyType1
            | PostApiAnalyticsBodyFiltersEventsMetricsKeyType2
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
                events_metrics_key_type_1 = PostApiAnalyticsBodyFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = PostApiAnalyticsBodyFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key"))

        def _parse_events_metrics_value(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEventsMetricsValueType1
            | PostApiAnalyticsBodyFiltersEventsMetricsValueType2
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
                events_metrics_value_type_1 = PostApiAnalyticsBodyFiltersEventsMetricsValueType1.from_dict(data)

                return events_metrics_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = PostApiAnalyticsBodyFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value"))

        def _parse_events_event_details_key(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1
            | PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2
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
                events_event_details_key_type_1 = PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType1.from_dict(data)

                return events_event_details_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = PostApiAnalyticsBodyFiltersEventsEventDetailsKeyType2.from_dict(data)

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key"))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> (
            list[str]
            | PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1
            | PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2
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
                annotations_has_annotation_type_1 = PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType1.from_dict(
                    data
                )

                return annotations_has_annotation_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = PostApiAnalyticsBodyFiltersAnnotationsHasAnnotationType2.from_dict(data)

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation"))

        post_api_analytics_body_filters = cls(
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

        return post_api_analytics_body_filters
