from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_traces_search_body_filters_annotations_has_annotation_type_1 import (
        PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.post_api_traces_search_body_filters_annotations_has_annotation_type_2 import (
        PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_label_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsLabelType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_label_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsLabelType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_passed_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsPassedType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_passed_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsPassedType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_score_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsScoreType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_score_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsScoreType2,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_state_type_1 import (
        PostApiTracesSearchBodyFiltersEvaluationsStateType1,
    )
    from ..models.post_api_traces_search_body_filters_evaluations_state_type_2 import (
        PostApiTracesSearchBodyFiltersEvaluationsStateType2,
    )
    from ..models.post_api_traces_search_body_filters_events_event_details_key_type_1 import (
        PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1,
    )
    from ..models.post_api_traces_search_body_filters_events_event_details_key_type_2 import (
        PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2,
    )
    from ..models.post_api_traces_search_body_filters_events_event_type_type_1 import (
        PostApiTracesSearchBodyFiltersEventsEventTypeType1,
    )
    from ..models.post_api_traces_search_body_filters_events_event_type_type_2 import (
        PostApiTracesSearchBodyFiltersEventsEventTypeType2,
    )
    from ..models.post_api_traces_search_body_filters_events_metrics_key_type_1 import (
        PostApiTracesSearchBodyFiltersEventsMetricsKeyType1,
    )
    from ..models.post_api_traces_search_body_filters_events_metrics_key_type_2 import (
        PostApiTracesSearchBodyFiltersEventsMetricsKeyType2,
    )
    from ..models.post_api_traces_search_body_filters_events_metrics_value_type_1 import (
        PostApiTracesSearchBodyFiltersEventsMetricsValueType1,
    )
    from ..models.post_api_traces_search_body_filters_events_metrics_value_type_2 import (
        PostApiTracesSearchBodyFiltersEventsMetricsValueType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_customer_id_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataCustomerIdType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_customer_id_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataCustomerIdType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_key_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataKeyType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_key_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataKeyType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_labels_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataLabelsType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_labels_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataLabelsType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_prompt_ids_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataPromptIdsType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_prompt_ids_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataPromptIdsType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_thread_id_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataThreadIdType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_thread_id_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataThreadIdType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_user_id_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataUserIdType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_user_id_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataUserIdType2,
    )
    from ..models.post_api_traces_search_body_filters_metadata_value_type_1 import (
        PostApiTracesSearchBodyFiltersMetadataValueType1,
    )
    from ..models.post_api_traces_search_body_filters_metadata_value_type_2 import (
        PostApiTracesSearchBodyFiltersMetadataValueType2,
    )
    from ..models.post_api_traces_search_body_filters_spans_model_type_1 import (
        PostApiTracesSearchBodyFiltersSpansModelType1,
    )
    from ..models.post_api_traces_search_body_filters_spans_model_type_2 import (
        PostApiTracesSearchBodyFiltersSpansModelType2,
    )
    from ..models.post_api_traces_search_body_filters_spans_type_type_1 import (
        PostApiTracesSearchBodyFiltersSpansTypeType1,
    )
    from ..models.post_api_traces_search_body_filters_spans_type_type_2 import (
        PostApiTracesSearchBodyFiltersSpansTypeType2,
    )
    from ..models.post_api_traces_search_body_filters_topics_subtopics_type_1 import (
        PostApiTracesSearchBodyFiltersTopicsSubtopicsType1,
    )
    from ..models.post_api_traces_search_body_filters_topics_subtopics_type_2 import (
        PostApiTracesSearchBodyFiltersTopicsSubtopicsType2,
    )
    from ..models.post_api_traces_search_body_filters_topics_topics_type_1 import (
        PostApiTracesSearchBodyFiltersTopicsTopicsType1,
    )
    from ..models.post_api_traces_search_body_filters_topics_topics_type_2 import (
        PostApiTracesSearchBodyFiltersTopicsTopicsType2,
    )
    from ..models.post_api_traces_search_body_filters_traces_error_type_1 import (
        PostApiTracesSearchBodyFiltersTracesErrorType1,
    )
    from ..models.post_api_traces_search_body_filters_traces_error_type_2 import (
        PostApiTracesSearchBodyFiltersTracesErrorType2,
    )
    from ..models.post_api_traces_search_body_filters_traces_origin_type_1 import (
        PostApiTracesSearchBodyFiltersTracesOriginType1,
    )
    from ..models.post_api_traces_search_body_filters_traces_origin_type_2 import (
        PostApiTracesSearchBodyFiltersTracesOriginType2,
    )


T = TypeVar("T", bound="PostApiTracesSearchBodyFilters")


@_attrs_define
class PostApiTracesSearchBodyFilters:
    """
    Attributes:
        topics_topics (Union['PostApiTracesSearchBodyFiltersTopicsTopicsType1',
            'PostApiTracesSearchBodyFiltersTopicsTopicsType2', Unset, list[str]]):
        topics_subtopics (Union['PostApiTracesSearchBodyFiltersTopicsSubtopicsType1',
            'PostApiTracesSearchBodyFiltersTopicsSubtopicsType2', Unset, list[str]]):
        metadata_user_id (Union['PostApiTracesSearchBodyFiltersMetadataUserIdType1',
            'PostApiTracesSearchBodyFiltersMetadataUserIdType2', Unset, list[str]]):
        metadata_thread_id (Union['PostApiTracesSearchBodyFiltersMetadataThreadIdType1',
            'PostApiTracesSearchBodyFiltersMetadataThreadIdType2', Unset, list[str]]):
        metadata_customer_id (Union['PostApiTracesSearchBodyFiltersMetadataCustomerIdType1',
            'PostApiTracesSearchBodyFiltersMetadataCustomerIdType2', Unset, list[str]]):
        metadata_labels (Union['PostApiTracesSearchBodyFiltersMetadataLabelsType1',
            'PostApiTracesSearchBodyFiltersMetadataLabelsType2', Unset, list[str]]):
        metadata_key (Union['PostApiTracesSearchBodyFiltersMetadataKeyType1',
            'PostApiTracesSearchBodyFiltersMetadataKeyType2', Unset, list[str]]):
        metadata_value (Union['PostApiTracesSearchBodyFiltersMetadataValueType1',
            'PostApiTracesSearchBodyFiltersMetadataValueType2', Unset, list[str]]):
        metadata_prompt_ids (Union['PostApiTracesSearchBodyFiltersMetadataPromptIdsType1',
            'PostApiTracesSearchBodyFiltersMetadataPromptIdsType2', Unset, list[str]]):
        traces_origin (Union['PostApiTracesSearchBodyFiltersTracesOriginType1',
            'PostApiTracesSearchBodyFiltersTracesOriginType2', Unset, list[str]]):
        traces_error (Union['PostApiTracesSearchBodyFiltersTracesErrorType1',
            'PostApiTracesSearchBodyFiltersTracesErrorType2', Unset, list[str]]):
        spans_type (Union['PostApiTracesSearchBodyFiltersSpansTypeType1',
            'PostApiTracesSearchBodyFiltersSpansTypeType2', Unset, list[str]]):
        spans_model (Union['PostApiTracesSearchBodyFiltersSpansModelType1',
            'PostApiTracesSearchBodyFiltersSpansModelType2', Unset, list[str]]):
        evaluations_evaluator_id (Union['PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1',
            'PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2', Unset, list[str]]):
        evaluations_evaluator_id_guardrails_only
            (Union['PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1',
            'PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2', Unset, list[str]]):
        evaluations_passed (Union['PostApiTracesSearchBodyFiltersEvaluationsPassedType1',
            'PostApiTracesSearchBodyFiltersEvaluationsPassedType2', Unset, list[str]]):
        evaluations_score (Union['PostApiTracesSearchBodyFiltersEvaluationsScoreType1',
            'PostApiTracesSearchBodyFiltersEvaluationsScoreType2', Unset, list[str]]):
        evaluations_state (Union['PostApiTracesSearchBodyFiltersEvaluationsStateType1',
            'PostApiTracesSearchBodyFiltersEvaluationsStateType2', Unset, list[str]]):
        evaluations_label (Union['PostApiTracesSearchBodyFiltersEvaluationsLabelType1',
            'PostApiTracesSearchBodyFiltersEvaluationsLabelType2', Unset, list[str]]):
        events_event_type (Union['PostApiTracesSearchBodyFiltersEventsEventTypeType1',
            'PostApiTracesSearchBodyFiltersEventsEventTypeType2', Unset, list[str]]):
        events_metrics_key (Union['PostApiTracesSearchBodyFiltersEventsMetricsKeyType1',
            'PostApiTracesSearchBodyFiltersEventsMetricsKeyType2', Unset, list[str]]):
        events_metrics_value (Union['PostApiTracesSearchBodyFiltersEventsMetricsValueType1',
            'PostApiTracesSearchBodyFiltersEventsMetricsValueType2', Unset, list[str]]):
        events_event_details_key (Union['PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1',
            'PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2', Unset, list[str]]):
        annotations_has_annotation (Union['PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1',
            'PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2', Unset, list[str]]):
    """

    topics_topics: Union[
        "PostApiTracesSearchBodyFiltersTopicsTopicsType1",
        "PostApiTracesSearchBodyFiltersTopicsTopicsType2",
        Unset,
        list[str],
    ] = UNSET
    topics_subtopics: Union[
        "PostApiTracesSearchBodyFiltersTopicsSubtopicsType1",
        "PostApiTracesSearchBodyFiltersTopicsSubtopicsType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_user_id: Union[
        "PostApiTracesSearchBodyFiltersMetadataUserIdType1",
        "PostApiTracesSearchBodyFiltersMetadataUserIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_thread_id: Union[
        "PostApiTracesSearchBodyFiltersMetadataThreadIdType1",
        "PostApiTracesSearchBodyFiltersMetadataThreadIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_customer_id: Union[
        "PostApiTracesSearchBodyFiltersMetadataCustomerIdType1",
        "PostApiTracesSearchBodyFiltersMetadataCustomerIdType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_labels: Union[
        "PostApiTracesSearchBodyFiltersMetadataLabelsType1",
        "PostApiTracesSearchBodyFiltersMetadataLabelsType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_key: Union[
        "PostApiTracesSearchBodyFiltersMetadataKeyType1",
        "PostApiTracesSearchBodyFiltersMetadataKeyType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_value: Union[
        "PostApiTracesSearchBodyFiltersMetadataValueType1",
        "PostApiTracesSearchBodyFiltersMetadataValueType2",
        Unset,
        list[str],
    ] = UNSET
    metadata_prompt_ids: Union[
        "PostApiTracesSearchBodyFiltersMetadataPromptIdsType1",
        "PostApiTracesSearchBodyFiltersMetadataPromptIdsType2",
        Unset,
        list[str],
    ] = UNSET
    traces_origin: Union[
        "PostApiTracesSearchBodyFiltersTracesOriginType1",
        "PostApiTracesSearchBodyFiltersTracesOriginType2",
        Unset,
        list[str],
    ] = UNSET
    traces_error: Union[
        "PostApiTracesSearchBodyFiltersTracesErrorType1",
        "PostApiTracesSearchBodyFiltersTracesErrorType2",
        Unset,
        list[str],
    ] = UNSET
    spans_type: Union[
        "PostApiTracesSearchBodyFiltersSpansTypeType1", "PostApiTracesSearchBodyFiltersSpansTypeType2", Unset, list[str]
    ] = UNSET
    spans_model: Union[
        "PostApiTracesSearchBodyFiltersSpansModelType1",
        "PostApiTracesSearchBodyFiltersSpansModelType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_evaluator_id: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1",
        "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_evaluator_id_guardrails_only: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1",
        "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_passed: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsPassedType1",
        "PostApiTracesSearchBodyFiltersEvaluationsPassedType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_score: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsScoreType1",
        "PostApiTracesSearchBodyFiltersEvaluationsScoreType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_state: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsStateType1",
        "PostApiTracesSearchBodyFiltersEvaluationsStateType2",
        Unset,
        list[str],
    ] = UNSET
    evaluations_label: Union[
        "PostApiTracesSearchBodyFiltersEvaluationsLabelType1",
        "PostApiTracesSearchBodyFiltersEvaluationsLabelType2",
        Unset,
        list[str],
    ] = UNSET
    events_event_type: Union[
        "PostApiTracesSearchBodyFiltersEventsEventTypeType1",
        "PostApiTracesSearchBodyFiltersEventsEventTypeType2",
        Unset,
        list[str],
    ] = UNSET
    events_metrics_key: Union[
        "PostApiTracesSearchBodyFiltersEventsMetricsKeyType1",
        "PostApiTracesSearchBodyFiltersEventsMetricsKeyType2",
        Unset,
        list[str],
    ] = UNSET
    events_metrics_value: Union[
        "PostApiTracesSearchBodyFiltersEventsMetricsValueType1",
        "PostApiTracesSearchBodyFiltersEventsMetricsValueType2",
        Unset,
        list[str],
    ] = UNSET
    events_event_details_key: Union[
        "PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1",
        "PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2",
        Unset,
        list[str],
    ] = UNSET
    annotations_has_annotation: Union[
        "PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1",
        "PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2",
        Unset,
        list[str],
    ] = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_traces_search_body_filters_annotations_has_annotation_type_1 import (
            PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_label_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_passed_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_score_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_state_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_traces_search_body_filters_events_event_details_key_type_1 import (
            PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_events_event_type_type_1 import (
            PostApiTracesSearchBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_key_type_1 import (
            PostApiTracesSearchBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_value_type_1 import (
            PostApiTracesSearchBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_customer_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_key_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_labels_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_prompt_ids_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_thread_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_user_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_value_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_traces_search_body_filters_spans_model_type_1 import (
            PostApiTracesSearchBodyFiltersSpansModelType1,
        )
        from ..models.post_api_traces_search_body_filters_spans_type_type_1 import (
            PostApiTracesSearchBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_traces_search_body_filters_topics_subtopics_type_1 import (
            PostApiTracesSearchBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_traces_search_body_filters_topics_topics_type_1 import (
            PostApiTracesSearchBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_traces_search_body_filters_traces_error_type_1 import (
            PostApiTracesSearchBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_traces_search_body_filters_traces_origin_type_1 import (
            PostApiTracesSearchBodyFiltersTracesOriginType1,
        )

        topics_topics: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.topics_topics, Unset):
            topics_topics = UNSET
        elif isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, PostApiTracesSearchBodyFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.topics_subtopics, Unset):
            topics_subtopics = UNSET
        elif isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, PostApiTracesSearchBodyFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_user_id, Unset):
            metadata_user_id = UNSET
        elif isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, PostApiTracesSearchBodyFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_thread_id, Unset):
            metadata_thread_id = UNSET
        elif isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, PostApiTracesSearchBodyFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_customer_id, Unset):
            metadata_customer_id = UNSET
        elif isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, PostApiTracesSearchBodyFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_labels, Unset):
            metadata_labels = UNSET
        elif isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, PostApiTracesSearchBodyFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_key, Unset):
            metadata_key = UNSET
        elif isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, PostApiTracesSearchBodyFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_value, Unset):
            metadata_value = UNSET
        elif isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, PostApiTracesSearchBodyFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.metadata_prompt_ids, Unset):
            metadata_prompt_ids = UNSET
        elif isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, PostApiTracesSearchBodyFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.traces_origin, Unset):
            traces_origin = UNSET
        elif isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, PostApiTracesSearchBodyFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.traces_error, Unset):
            traces_error = UNSET
        elif isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, PostApiTracesSearchBodyFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        spans_type: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.spans_type, Unset):
            spans_type = UNSET
        elif isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, PostApiTracesSearchBodyFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.spans_model, Unset):
            spans_model = UNSET
        elif isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, PostApiTracesSearchBodyFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_evaluator_id, Unset):
            evaluations_evaluator_id = UNSET
        elif isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(self.evaluations_evaluator_id, PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1):
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
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_passed: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_passed, Unset):
            evaluations_passed = UNSET
        elif isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, PostApiTracesSearchBodyFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_score, Unset):
            evaluations_score = UNSET
        elif isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, PostApiTracesSearchBodyFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_state, Unset):
            evaluations_state = UNSET
        elif isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, PostApiTracesSearchBodyFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.evaluations_label, Unset):
            evaluations_label = UNSET
        elif isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, PostApiTracesSearchBodyFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_event_type, Unset):
            events_event_type = UNSET
        elif isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, PostApiTracesSearchBodyFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_metrics_key, Unset):
            events_metrics_key = UNSET
        elif isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, PostApiTracesSearchBodyFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_metrics_value, Unset):
            events_metrics_value = UNSET
        elif isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, PostApiTracesSearchBodyFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.events_event_details_key, Unset):
            events_event_details_key = UNSET
        elif isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: Union[Unset, dict[str, Any], list[str]]
        if isinstance(self.annotations_has_annotation, Unset):
            annotations_has_annotation = UNSET
        elif isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(self.annotations_has_annotation, PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1):
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
        from ..models.post_api_traces_search_body_filters_annotations_has_annotation_type_1 import (
            PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.post_api_traces_search_body_filters_annotations_has_annotation_type_2 import (
            PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_evaluator_id_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_label_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsLabelType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_label_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsLabelType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_passed_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsPassedType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_passed_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsPassedType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_score_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsScoreType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_score_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsScoreType2,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_state_type_1 import (
            PostApiTracesSearchBodyFiltersEvaluationsStateType1,
        )
        from ..models.post_api_traces_search_body_filters_evaluations_state_type_2 import (
            PostApiTracesSearchBodyFiltersEvaluationsStateType2,
        )
        from ..models.post_api_traces_search_body_filters_events_event_details_key_type_1 import (
            PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_events_event_details_key_type_2 import (
            PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2,
        )
        from ..models.post_api_traces_search_body_filters_events_event_type_type_1 import (
            PostApiTracesSearchBodyFiltersEventsEventTypeType1,
        )
        from ..models.post_api_traces_search_body_filters_events_event_type_type_2 import (
            PostApiTracesSearchBodyFiltersEventsEventTypeType2,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_key_type_1 import (
            PostApiTracesSearchBodyFiltersEventsMetricsKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_key_type_2 import (
            PostApiTracesSearchBodyFiltersEventsMetricsKeyType2,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_value_type_1 import (
            PostApiTracesSearchBodyFiltersEventsMetricsValueType1,
        )
        from ..models.post_api_traces_search_body_filters_events_metrics_value_type_2 import (
            PostApiTracesSearchBodyFiltersEventsMetricsValueType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_customer_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataCustomerIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_customer_id_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataCustomerIdType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_key_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataKeyType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_key_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataKeyType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_labels_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataLabelsType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_labels_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataLabelsType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_prompt_ids_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataPromptIdsType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_prompt_ids_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataPromptIdsType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_thread_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataThreadIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_thread_id_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataThreadIdType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_user_id_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataUserIdType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_user_id_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataUserIdType2,
        )
        from ..models.post_api_traces_search_body_filters_metadata_value_type_1 import (
            PostApiTracesSearchBodyFiltersMetadataValueType1,
        )
        from ..models.post_api_traces_search_body_filters_metadata_value_type_2 import (
            PostApiTracesSearchBodyFiltersMetadataValueType2,
        )
        from ..models.post_api_traces_search_body_filters_spans_model_type_1 import (
            PostApiTracesSearchBodyFiltersSpansModelType1,
        )
        from ..models.post_api_traces_search_body_filters_spans_model_type_2 import (
            PostApiTracesSearchBodyFiltersSpansModelType2,
        )
        from ..models.post_api_traces_search_body_filters_spans_type_type_1 import (
            PostApiTracesSearchBodyFiltersSpansTypeType1,
        )
        from ..models.post_api_traces_search_body_filters_spans_type_type_2 import (
            PostApiTracesSearchBodyFiltersSpansTypeType2,
        )
        from ..models.post_api_traces_search_body_filters_topics_subtopics_type_1 import (
            PostApiTracesSearchBodyFiltersTopicsSubtopicsType1,
        )
        from ..models.post_api_traces_search_body_filters_topics_subtopics_type_2 import (
            PostApiTracesSearchBodyFiltersTopicsSubtopicsType2,
        )
        from ..models.post_api_traces_search_body_filters_topics_topics_type_1 import (
            PostApiTracesSearchBodyFiltersTopicsTopicsType1,
        )
        from ..models.post_api_traces_search_body_filters_topics_topics_type_2 import (
            PostApiTracesSearchBodyFiltersTopicsTopicsType2,
        )
        from ..models.post_api_traces_search_body_filters_traces_error_type_1 import (
            PostApiTracesSearchBodyFiltersTracesErrorType1,
        )
        from ..models.post_api_traces_search_body_filters_traces_error_type_2 import (
            PostApiTracesSearchBodyFiltersTracesErrorType2,
        )
        from ..models.post_api_traces_search_body_filters_traces_origin_type_1 import (
            PostApiTracesSearchBodyFiltersTracesOriginType1,
        )
        from ..models.post_api_traces_search_body_filters_traces_origin_type_2 import (
            PostApiTracesSearchBodyFiltersTracesOriginType2,
        )

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersTopicsTopicsType1",
            "PostApiTracesSearchBodyFiltersTopicsTopicsType2",
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
                topics_topics_type_1 = PostApiTracesSearchBodyFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = PostApiTracesSearchBodyFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics", UNSET))

        def _parse_topics_subtopics(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersTopicsSubtopicsType1",
            "PostApiTracesSearchBodyFiltersTopicsSubtopicsType2",
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
                topics_subtopics_type_1 = PostApiTracesSearchBodyFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = PostApiTracesSearchBodyFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics", UNSET))

        def _parse_metadata_user_id(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataUserIdType1",
            "PostApiTracesSearchBodyFiltersMetadataUserIdType2",
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
                metadata_user_id_type_1 = PostApiTracesSearchBodyFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = PostApiTracesSearchBodyFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id", UNSET))

        def _parse_metadata_thread_id(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataThreadIdType1",
            "PostApiTracesSearchBodyFiltersMetadataThreadIdType2",
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
                metadata_thread_id_type_1 = PostApiTracesSearchBodyFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = PostApiTracesSearchBodyFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id", UNSET))

        def _parse_metadata_customer_id(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataCustomerIdType1",
            "PostApiTracesSearchBodyFiltersMetadataCustomerIdType2",
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
                metadata_customer_id_type_1 = PostApiTracesSearchBodyFiltersMetadataCustomerIdType1.from_dict(data)

                return metadata_customer_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = PostApiTracesSearchBodyFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id", UNSET))

        def _parse_metadata_labels(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataLabelsType1",
            "PostApiTracesSearchBodyFiltersMetadataLabelsType2",
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
                metadata_labels_type_1 = PostApiTracesSearchBodyFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = PostApiTracesSearchBodyFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels", UNSET))

        def _parse_metadata_key(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataKeyType1",
            "PostApiTracesSearchBodyFiltersMetadataKeyType2",
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
                metadata_key_type_1 = PostApiTracesSearchBodyFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = PostApiTracesSearchBodyFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key", UNSET))

        def _parse_metadata_value(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataValueType1",
            "PostApiTracesSearchBodyFiltersMetadataValueType2",
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
                metadata_value_type_1 = PostApiTracesSearchBodyFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = PostApiTracesSearchBodyFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value", UNSET))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersMetadataPromptIdsType1",
            "PostApiTracesSearchBodyFiltersMetadataPromptIdsType2",
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
                metadata_prompt_ids_type_1 = PostApiTracesSearchBodyFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = PostApiTracesSearchBodyFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids", UNSET))

        def _parse_traces_origin(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersTracesOriginType1",
            "PostApiTracesSearchBodyFiltersTracesOriginType2",
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
                traces_origin_type_1 = PostApiTracesSearchBodyFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = PostApiTracesSearchBodyFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin", UNSET))

        def _parse_traces_error(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersTracesErrorType1",
            "PostApiTracesSearchBodyFiltersTracesErrorType2",
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
                traces_error_type_1 = PostApiTracesSearchBodyFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = PostApiTracesSearchBodyFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error", UNSET))

        def _parse_spans_type(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersSpansTypeType1",
            "PostApiTracesSearchBodyFiltersSpansTypeType2",
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
                spans_type_type_1 = PostApiTracesSearchBodyFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = PostApiTracesSearchBodyFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type", UNSET))

        def _parse_spans_model(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersSpansModelType1",
            "PostApiTracesSearchBodyFiltersSpansModelType2",
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
                spans_model_type_1 = PostApiTracesSearchBodyFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = PostApiTracesSearchBodyFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model", UNSET))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1",
            "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2",
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
                evaluations_evaluator_id_type_1 = PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType1.from_dict(
                    data
                )

                return evaluations_evaluator_id_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdType2.from_dict(data)

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id", UNSET))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1",
            "PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2",
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
                    PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                PostApiTracesSearchBodyFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only", UNSET)
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsPassedType1",
            "PostApiTracesSearchBodyFiltersEvaluationsPassedType2",
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
                evaluations_passed_type_1 = PostApiTracesSearchBodyFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = PostApiTracesSearchBodyFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed", UNSET))

        def _parse_evaluations_score(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsScoreType1",
            "PostApiTracesSearchBodyFiltersEvaluationsScoreType2",
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
                evaluations_score_type_1 = PostApiTracesSearchBodyFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = PostApiTracesSearchBodyFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score", UNSET))

        def _parse_evaluations_state(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsStateType1",
            "PostApiTracesSearchBodyFiltersEvaluationsStateType2",
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
                evaluations_state_type_1 = PostApiTracesSearchBodyFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = PostApiTracesSearchBodyFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state", UNSET))

        def _parse_evaluations_label(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEvaluationsLabelType1",
            "PostApiTracesSearchBodyFiltersEvaluationsLabelType2",
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
                evaluations_label_type_1 = PostApiTracesSearchBodyFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = PostApiTracesSearchBodyFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label", UNSET))

        def _parse_events_event_type(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEventsEventTypeType1",
            "PostApiTracesSearchBodyFiltersEventsEventTypeType2",
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
                events_event_type_type_1 = PostApiTracesSearchBodyFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = PostApiTracesSearchBodyFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type", UNSET))

        def _parse_events_metrics_key(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEventsMetricsKeyType1",
            "PostApiTracesSearchBodyFiltersEventsMetricsKeyType2",
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
                events_metrics_key_type_1 = PostApiTracesSearchBodyFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = PostApiTracesSearchBodyFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key", UNSET))

        def _parse_events_metrics_value(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEventsMetricsValueType1",
            "PostApiTracesSearchBodyFiltersEventsMetricsValueType2",
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
                events_metrics_value_type_1 = PostApiTracesSearchBodyFiltersEventsMetricsValueType1.from_dict(data)

                return events_metrics_value_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = PostApiTracesSearchBodyFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value", UNSET))

        def _parse_events_event_details_key(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1",
            "PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2",
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
                events_event_details_key_type_1 = PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType1.from_dict(
                    data
                )

                return events_event_details_key_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = PostApiTracesSearchBodyFiltersEventsEventDetailsKeyType2.from_dict(data)

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key", UNSET))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> Union[
            "PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1",
            "PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2",
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
                    PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType1.from_dict(data)
                )

                return annotations_has_annotation_type_1
            except:  # noqa: E722
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = PostApiTracesSearchBodyFiltersAnnotationsHasAnnotationType2.from_dict(
                data
            )

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation", UNSET))

        post_api_traces_search_body_filters = cls(
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

        return post_api_traces_search_body_filters
