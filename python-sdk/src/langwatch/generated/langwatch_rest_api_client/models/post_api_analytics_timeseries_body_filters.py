from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_analytics_timeseries_body_filters_annotations_has_annotation_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_annotations_has_annotation_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_label_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_label_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_passed_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_passed_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_score_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_score_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_state_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_evaluations_state_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_event_details_key_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_event_details_key_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_event_type_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_event_type_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_metrics_key_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_metrics_key_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_metrics_value_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_events_metrics_value_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_customer_id_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_customer_id_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_key_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_key_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_labels_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_labels_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_prompt_ids_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_prompt_ids_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_thread_id_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_thread_id_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_user_id_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_user_id_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_value_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_metadata_value_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_spans_model_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_spans_model_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_spans_type_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_spans_type_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_topics_subtopics_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_topics_subtopics_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_topics_topics_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_topics_topics_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_traces_error_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_traces_error_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2,
    )
    from ..models.post_api_analytics_timeseries_body_filters_traces_origin_type_1 import (
        PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1,
    )
    from ..models.post_api_analytics_timeseries_body_filters_traces_origin_type_2 import (
        PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2,
    )


T = TypeVar("T", bound="PostApiAnalyticsTimeseriesBodyFilters")


@_attrs_define
class PostApiAnalyticsTimeseriesBodyFilters:
    """
    Attributes:
        topics_topics (Union['PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1',
            'PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2', Unset, list[str]]):
        topics_subtopics (Union['PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1',
            'PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2', Unset, list[str]]):
        metadata_user_id (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2', Unset, list[str]]):
        metadata_thread_id (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2', Unset, list[str]]):
        metadata_customer_id (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2', Unset, list[str]]):
        metadata_labels (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2', Unset, list[str]]):
        metadata_key (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2', Unset, list[str]]):
        metadata_value (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2', Unset, list[str]]):
        metadata_prompt_ids (Union['PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1',
            'PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2', Unset, list[str]]):
        traces_origin (Union['PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1',
            'PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2', Unset, list[str]]):
        traces_error (Union['PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1',
            'PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2', Unset, list[str]]):
        spans_type (Union['PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1',
            'PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2', Unset, list[str]]):
        spans_model (Union['PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1',
            'PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2', Unset, list[str]]):
        evaluations_evaluator_id (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2', Unset, list[str]]):
        evaluations_evaluator_id_guardrails_only
            (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2', Unset, list[str]]):
        evaluations_passed (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2', Unset, list[str]]):
        evaluations_score (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2', Unset, list[str]]):
        evaluations_state (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2', Unset, list[str]]):
        evaluations_label (Union['PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2', Unset, list[str]]):
        events_event_type (Union['PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2', Unset, list[str]]):
        events_metrics_key (Union['PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2', Unset, list[str]]):
        events_metrics_value (Union['PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2', Unset, list[str]]):
        events_event_details_key (Union['PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1',
            'PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2', Unset, list[str]]):
        annotations_has_annotation (Union['PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1',
            'PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2', Unset, list[str]]):
    """

    topics_topics: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1",
        "PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2",
        Unset,
        list[str],
    ] = UNSET
    topics_subtopics: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1",
        "PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_user_id: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_thread_id: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_customer_id: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_labels: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_key: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_value: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_prompt_ids: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1",
        "PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2",
        Unset,
        list[str],
    ] = UNSET
    traces_origin: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1",
        "PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2",
        Unset,
        list[str],
    ] = UNSET
    traces_error: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1",
        "PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2",
        Unset,
        list[str],
    ] = UNSET
    spans_type: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1",
        "PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2",
        Unset,
        list[str],
    ] = UNSET
    spans_model: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1",
        "PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_evaluator_id: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_evaluator_id_guardrails_only: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_passed: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_score: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_state: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_label: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2",
        Unset,
        list[str],
    ] = UNSET
    events_event_type: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2",
        Unset,
        list[str],
    ] = UNSET
    events_metrics_key: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2",
        Unset,
        list[str],
    ] = UNSET
    events_metrics_value: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2",
        Unset,
        list[str],
    ] = UNSET
    events_event_details_key: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1",
        "PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2",
        Unset,
        list[str],
    ] = UNSET
    annotations_has_annotation: Union[
        "PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1",
        "PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2",
        Unset,
        list[str],
    ] = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_analytics_timeseries_body_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_label_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_score_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_state_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_type_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_labels_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_value_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_model_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_type_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_topics_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_error_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_origin_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1,
        )

        topics_topics: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.topics_topics, Unset):
            topics_topics = UNSET
        elif isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.topics_subtopics, Unset):
            topics_subtopics = UNSET
        elif isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_user_id, Unset):
            metadata_user_id = UNSET
        elif isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_thread_id, Unset):
            metadata_thread_id = UNSET
        elif isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_customer_id, Unset):
            metadata_customer_id = UNSET
        elif isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_labels, Unset):
            metadata_labels = UNSET
        elif isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_key, Unset):
            metadata_key = UNSET
        elif isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_value, Unset):
            metadata_value = UNSET
        elif isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_prompt_ids, Unset):
            metadata_prompt_ids = UNSET
        elif isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.traces_origin, Unset):
            traces_origin = UNSET
        elif isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.traces_error, Unset):
            traces_error = UNSET
        elif isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        spans_type: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.spans_type, Unset):
            spans_type = UNSET
        elif isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.spans_model, Unset):
            spans_model = UNSET
        elif isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_evaluator_id, Unset):
            evaluations_evaluator_id = UNSET
        elif isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(
            self.evaluations_evaluator_id, PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1
        ):
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()
        else:
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()

        evaluations_evaluator_id_guardrails_only: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_evaluator_id_guardrails_only, Unset):
            evaluations_evaluator_id_guardrails_only = UNSET
        elif isinstance(self.evaluations_evaluator_id_guardrails_only, list):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only

        elif isinstance(
            self.evaluations_evaluator_id_guardrails_only,
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_passed: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_passed, Unset):
            evaluations_passed = UNSET
        elif isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_score, Unset):
            evaluations_score = UNSET
        elif isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_state, Unset):
            evaluations_state = UNSET
        elif isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_label, Unset):
            evaluations_label = UNSET
        elif isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_event_type, Unset):
            events_event_type = UNSET
        elif isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_metrics_key, Unset):
            events_metrics_key = UNSET
        elif isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_metrics_value, Unset):
            events_metrics_value = UNSET
        elif isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_event_details_key, Unset):
            events_event_details_key = UNSET
        elif isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.annotations_has_annotation, Unset):
            annotations_has_annotation = UNSET
        elif isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(
            self.annotations_has_annotation, PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1
        ):
            annotations_has_annotation = self.annotations_has_annotation.to_dict()
        else:
            annotations_has_annotation = self.annotations_has_annotation.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update({})
        if topics_topics is not UNSET:
            field_dict["topics.topics"] = topics_topics
        if topics_subtopics is not UNSET:
            field_dict["topics.subtopics"] = topics_subtopics
        if metadata_user_id is not UNSET:
            field_dict["metadata.user_id"] = metadata_user_id
        if metadata_thread_id is not UNSET:
            field_dict["metadata.thread_id"] = metadata_thread_id
        if metadata_customer_id is not UNSET:
            field_dict["metadata.customer_id"] = metadata_customer_id
        if metadata_labels is not UNSET:
            field_dict["metadata.labels"] = metadata_labels
        if metadata_key is not UNSET:
            field_dict["metadata.key"] = metadata_key
        if metadata_value is not UNSET:
            field_dict["metadata.value"] = metadata_value
        if metadata_prompt_ids is not UNSET:
            field_dict["metadata.prompt_ids"] = metadata_prompt_ids
        if traces_origin is not UNSET:
            field_dict["traces.origin"] = traces_origin
        if traces_error is not UNSET:
            field_dict["traces.error"] = traces_error
        if spans_type is not UNSET:
            field_dict["spans.type"] = spans_type
        if spans_model is not UNSET:
            field_dict["spans.model"] = spans_model
        if evaluations_evaluator_id is not UNSET:
            field_dict["evaluations.evaluator_id"] = evaluations_evaluator_id
        if evaluations_evaluator_id_guardrails_only is not UNSET:
            field_dict["evaluations.evaluator_id.guardrails_only"] = evaluations_evaluator_id_guardrails_only
        if evaluations_passed is not UNSET:
            field_dict["evaluations.passed"] = evaluations_passed
        if evaluations_score is not UNSET:
            field_dict["evaluations.score"] = evaluations_score
        if evaluations_state is not UNSET:
            field_dict["evaluations.state"] = evaluations_state
        if evaluations_label is not UNSET:
            field_dict["evaluations.label"] = evaluations_label
        if events_event_type is not UNSET:
            field_dict["events.event_type"] = events_event_type
        if events_metrics_key is not UNSET:
            field_dict["events.metrics.key"] = events_metrics_key
        if events_metrics_value is not UNSET:
            field_dict["events.metrics.value"] = events_metrics_value
        if events_event_details_key is not UNSET:
            field_dict["events.event_details.key"] = events_event_details_key
        if annotations_has_annotation is not UNSET:
            field_dict["annotations.hasAnnotation"] = annotations_has_annotation

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_analytics_timeseries_body_filters_annotations_has_annotation_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_annotations_has_annotation_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_evaluator_id_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_label_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_label_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_passed_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_passed_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_score_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_score_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_state_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_evaluations_state_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_details_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_details_key_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_type_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_event_type_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_key_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_value_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_events_metrics_value_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_customer_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_customer_id_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_key_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_key_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_labels_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_labels_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_prompt_ids_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_prompt_ids_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_thread_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_thread_id_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_user_id_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_user_id_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_value_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_metadata_value_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_model_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_model_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_type_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_spans_type_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_subtopics_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_subtopics_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_topics_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_topics_topics_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_error_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_error_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_origin_type_1 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1,
        )
        from ..models.post_api_analytics_timeseries_body_filters_traces_origin_type_2 import (
            PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2,
        )

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1",
            "PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                topics_topics_type_0 = cast(list[str], data)

                return topics_topics_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                topics_topics_type_1 = PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = PostApiAnalyticsTimeseriesBodyFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics", UNSET))

        def _parse_topics_subtopics(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1",
            "PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                topics_subtopics_type_0 = cast(list[str], data)

                return topics_subtopics_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                topics_subtopics_type_1 = PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = PostApiAnalyticsTimeseriesBodyFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics", UNSET))

        def _parse_metadata_user_id(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_user_id_type_0 = cast(list[str], data)

                return metadata_user_id_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_user_id_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id", UNSET))

        def _parse_metadata_thread_id(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_thread_id_type_0 = cast(list[str], data)

                return metadata_thread_id_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_thread_id_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id", UNSET))

        def _parse_metadata_customer_id(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_customer_id_type_0 = cast(list[str], data)

                return metadata_customer_id_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_customer_id_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType1.from_dict(
                    data
                )

                return metadata_customer_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id", UNSET))

        def _parse_metadata_labels(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_labels_type_0 = cast(list[str], data)

                return metadata_labels_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_labels_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels", UNSET))

        def _parse_metadata_key(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_key_type_0 = cast(list[str], data)

                return metadata_key_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_key_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key", UNSET))

        def _parse_metadata_value(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_value_type_0 = cast(list[str], data)

                return metadata_value_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_value_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value", UNSET))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1",
            "PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                metadata_prompt_ids_type_0 = cast(list[str], data)

                return metadata_prompt_ids_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                metadata_prompt_ids_type_1 = PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = PostApiAnalyticsTimeseriesBodyFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids", UNSET))

        def _parse_traces_origin(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1",
            "PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                traces_origin_type_0 = cast(list[str], data)

                return traces_origin_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                traces_origin_type_1 = PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = PostApiAnalyticsTimeseriesBodyFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin", UNSET))

        def _parse_traces_error(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1",
            "PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                traces_error_type_0 = cast(list[str], data)

                return traces_error_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                traces_error_type_1 = PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = PostApiAnalyticsTimeseriesBodyFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error", UNSET))

        def _parse_spans_type(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1",
            "PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                spans_type_type_0 = cast(list[str], data)

                return spans_type_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                spans_type_type_1 = PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = PostApiAnalyticsTimeseriesBodyFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type", UNSET))

        def _parse_spans_model(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1",
            "PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                spans_model_type_0 = cast(list[str], data)

                return spans_model_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                spans_model_type_1 = PostApiAnalyticsTimeseriesBodyFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = PostApiAnalyticsTimeseriesBodyFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model", UNSET))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_type_1 = (
                    PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType1.from_dict(data)
                )

                return evaluations_evaluator_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = (
                PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdType2.from_dict(data)
            )

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id", UNSET))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_evaluator_id_guardrails_only_type_0 = cast(list[str], data)

                return evaluations_evaluator_id_guardrails_only_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_evaluator_id_guardrails_only_type_1 = (
                    PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                PostApiAnalyticsTimeseriesBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only", UNSET)
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_passed_type_0 = cast(list[str], data)

                return evaluations_passed_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_passed_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed", UNSET))

        def _parse_evaluations_score(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_score_type_0 = cast(list[str], data)

                return evaluations_score_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_score_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score", UNSET))

        def _parse_evaluations_state(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_state_type_0 = cast(list[str], data)

                return evaluations_state_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_state_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state", UNSET))

        def _parse_evaluations_label(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                evaluations_label_type_0 = cast(list[str], data)

                return evaluations_label_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                evaluations_label_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label", UNSET))

        def _parse_events_event_type(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_event_type_type_0 = cast(list[str], data)

                return events_event_type_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_event_type_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type", UNSET))

        def _parse_events_metrics_key(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_metrics_key_type_0 = cast(list[str], data)

                return events_metrics_key_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_metrics_key_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key", UNSET))

        def _parse_events_metrics_value(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_metrics_value_type_0 = cast(list[str], data)

                return events_metrics_value_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_metrics_value_type_1 = PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType1.from_dict(
                    data
                )

                return events_metrics_value_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value", UNSET))

        def _parse_events_event_details_key(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1",
            "PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                events_event_details_key_type_0 = cast(list[str], data)

                return events_event_details_key_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                events_event_details_key_type_1 = (
                    PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType1.from_dict(data)
                )

                return events_event_details_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = PostApiAnalyticsTimeseriesBodyFiltersEventsEventDetailsKeyType2.from_dict(
                data
            )

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key", UNSET))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> Union[
            "PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1",
            "PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2",
            Unset,
            list[str],
        ]:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                annotations_has_annotation_type_0 = cast(list[str], data)

                return annotations_has_annotation_type_0
            except:  # noqa: E722
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                annotations_has_annotation_type_1 = (
                    PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType1.from_dict(data)
                )

                return annotations_has_annotation_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = (
                PostApiAnalyticsTimeseriesBodyFiltersAnnotationsHasAnnotationType2.from_dict(data)
            )

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation", UNSET))

        post_api_analytics_timeseries_body_filters = cls(
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
            spans_type=spans_type,
            spans_model=spans_model,
            evaluations_evaluator_id=evaluations_evaluator_id,
            evaluations_evaluator_id_guardrails_only=evaluations_evaluator_id_guardrails_only,
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

        return post_api_analytics_timeseries_body_filters
