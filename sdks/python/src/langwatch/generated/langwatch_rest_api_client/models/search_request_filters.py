from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.search_request_filters_additional_property_type_1 import SearchRequestFiltersAdditionalPropertyType1
    from ..models.search_request_filters_additional_property_type_2 import SearchRequestFiltersAdditionalPropertyType2
    from ..models.search_request_filters_annotations_has_annotation_type_1 import (
        SearchRequestFiltersAnnotationsHasAnnotationType1,
    )
    from ..models.search_request_filters_annotations_has_annotation_type_2 import (
        SearchRequestFiltersAnnotationsHasAnnotationType2,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
        SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
        SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_label_type_1 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_label_type_2 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_passed_type_1 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_passed_type_2 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_1 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_2 import (
        SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_type_1 import (
        SearchRequestFiltersEvaluationsEvaluatorIdType1,
    )
    from ..models.search_request_filters_evaluations_evaluator_id_type_2 import (
        SearchRequestFiltersEvaluationsEvaluatorIdType2,
    )
    from ..models.search_request_filters_evaluations_label_type_1 import SearchRequestFiltersEvaluationsLabelType1
    from ..models.search_request_filters_evaluations_label_type_2 import SearchRequestFiltersEvaluationsLabelType2
    from ..models.search_request_filters_evaluations_passed_type_1 import SearchRequestFiltersEvaluationsPassedType1
    from ..models.search_request_filters_evaluations_passed_type_2 import SearchRequestFiltersEvaluationsPassedType2
    from ..models.search_request_filters_evaluations_score_type_1 import SearchRequestFiltersEvaluationsScoreType1
    from ..models.search_request_filters_evaluations_score_type_2 import SearchRequestFiltersEvaluationsScoreType2
    from ..models.search_request_filters_evaluations_state_type_1 import SearchRequestFiltersEvaluationsStateType1
    from ..models.search_request_filters_evaluations_state_type_2 import SearchRequestFiltersEvaluationsStateType2
    from ..models.search_request_filters_events_event_details_key_type_1 import (
        SearchRequestFiltersEventsEventDetailsKeyType1,
    )
    from ..models.search_request_filters_events_event_details_key_type_2 import (
        SearchRequestFiltersEventsEventDetailsKeyType2,
    )
    from ..models.search_request_filters_events_event_type_type_1 import SearchRequestFiltersEventsEventTypeType1
    from ..models.search_request_filters_events_event_type_type_2 import SearchRequestFiltersEventsEventTypeType2
    from ..models.search_request_filters_events_metrics_key_type_1 import SearchRequestFiltersEventsMetricsKeyType1
    from ..models.search_request_filters_events_metrics_key_type_2 import SearchRequestFiltersEventsMetricsKeyType2
    from ..models.search_request_filters_events_metrics_value_type_1 import SearchRequestFiltersEventsMetricsValueType1
    from ..models.search_request_filters_events_metrics_value_type_2 import SearchRequestFiltersEventsMetricsValueType2
    from ..models.search_request_filters_metadata_customer_id_type_1 import SearchRequestFiltersMetadataCustomerIdType1
    from ..models.search_request_filters_metadata_customer_id_type_2 import SearchRequestFiltersMetadataCustomerIdType2
    from ..models.search_request_filters_metadata_key_type_1 import SearchRequestFiltersMetadataKeyType1
    from ..models.search_request_filters_metadata_key_type_2 import SearchRequestFiltersMetadataKeyType2
    from ..models.search_request_filters_metadata_labels_type_1 import SearchRequestFiltersMetadataLabelsType1
    from ..models.search_request_filters_metadata_labels_type_2 import SearchRequestFiltersMetadataLabelsType2
    from ..models.search_request_filters_metadata_prompt_ids_type_1 import SearchRequestFiltersMetadataPromptIdsType1
    from ..models.search_request_filters_metadata_prompt_ids_type_2 import SearchRequestFiltersMetadataPromptIdsType2
    from ..models.search_request_filters_metadata_thread_id_type_1 import SearchRequestFiltersMetadataThreadIdType1
    from ..models.search_request_filters_metadata_thread_id_type_2 import SearchRequestFiltersMetadataThreadIdType2
    from ..models.search_request_filters_metadata_user_id_type_1 import SearchRequestFiltersMetadataUserIdType1
    from ..models.search_request_filters_metadata_user_id_type_2 import SearchRequestFiltersMetadataUserIdType2
    from ..models.search_request_filters_metadata_value_type_1 import SearchRequestFiltersMetadataValueType1
    from ..models.search_request_filters_metadata_value_type_2 import SearchRequestFiltersMetadataValueType2
    from ..models.search_request_filters_spans_model_type_1 import SearchRequestFiltersSpansModelType1
    from ..models.search_request_filters_spans_model_type_2 import SearchRequestFiltersSpansModelType2
    from ..models.search_request_filters_spans_type_type_1 import SearchRequestFiltersSpansTypeType1
    from ..models.search_request_filters_spans_type_type_2 import SearchRequestFiltersSpansTypeType2
    from ..models.search_request_filters_topics_subtopics_type_1 import SearchRequestFiltersTopicsSubtopicsType1
    from ..models.search_request_filters_topics_subtopics_type_2 import SearchRequestFiltersTopicsSubtopicsType2
    from ..models.search_request_filters_topics_topics_type_1 import SearchRequestFiltersTopicsTopicsType1
    from ..models.search_request_filters_topics_topics_type_2 import SearchRequestFiltersTopicsTopicsType2
    from ..models.search_request_filters_traces_error_type_1 import SearchRequestFiltersTracesErrorType1
    from ..models.search_request_filters_traces_error_type_2 import SearchRequestFiltersTracesErrorType2
    from ..models.search_request_filters_traces_name_type_1 import SearchRequestFiltersTracesNameType1
    from ..models.search_request_filters_traces_name_type_2 import SearchRequestFiltersTracesNameType2
    from ..models.search_request_filters_traces_origin_type_1 import SearchRequestFiltersTracesOriginType1
    from ..models.search_request_filters_traces_origin_type_2 import SearchRequestFiltersTracesOriginType2


T = TypeVar("T", bound="SearchRequestFilters")


@_attrs_define
class SearchRequestFilters:
    """
    Attributes:
        topics_topics (list[str] | SearchRequestFiltersTopicsTopicsType1 | SearchRequestFiltersTopicsTopicsType2 |
            Unset):
        topics_subtopics (list[str] | SearchRequestFiltersTopicsSubtopicsType1 |
            SearchRequestFiltersTopicsSubtopicsType2 | Unset):
        metadata_user_id (list[str] | SearchRequestFiltersMetadataUserIdType1 | SearchRequestFiltersMetadataUserIdType2
            | Unset):
        metadata_thread_id (list[str] | SearchRequestFiltersMetadataThreadIdType1 |
            SearchRequestFiltersMetadataThreadIdType2 | Unset):
        metadata_customer_id (list[str] | SearchRequestFiltersMetadataCustomerIdType1 |
            SearchRequestFiltersMetadataCustomerIdType2 | Unset):
        metadata_labels (list[str] | SearchRequestFiltersMetadataLabelsType1 | SearchRequestFiltersMetadataLabelsType2 |
            Unset):
        metadata_key (list[str] | SearchRequestFiltersMetadataKeyType1 | SearchRequestFiltersMetadataKeyType2 | Unset):
        metadata_value (list[str] | SearchRequestFiltersMetadataValueType1 | SearchRequestFiltersMetadataValueType2 |
            Unset):
        metadata_prompt_ids (list[str] | SearchRequestFiltersMetadataPromptIdsType1 |
            SearchRequestFiltersMetadataPromptIdsType2 | Unset):
        traces_origin (list[str] | SearchRequestFiltersTracesOriginType1 | SearchRequestFiltersTracesOriginType2 |
            Unset):
        traces_error (list[str] | SearchRequestFiltersTracesErrorType1 | SearchRequestFiltersTracesErrorType2 | Unset):
        traces_name (list[str] | SearchRequestFiltersTracesNameType1 | SearchRequestFiltersTracesNameType2 | Unset):
        spans_type (list[str] | SearchRequestFiltersSpansTypeType1 | SearchRequestFiltersSpansTypeType2 | Unset):
        spans_model (list[str] | SearchRequestFiltersSpansModelType1 | SearchRequestFiltersSpansModelType2 | Unset):
        evaluations_evaluator_id (list[str] | SearchRequestFiltersEvaluationsEvaluatorIdType1 |
            SearchRequestFiltersEvaluationsEvaluatorIdType2 | Unset):
        evaluations_evaluator_id_guardrails_only (list[str] |
            SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1 |
            SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2 | Unset):
        evaluations_evaluator_id_has_passed (list[str] | SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1 |
            SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2 | Unset):
        evaluations_evaluator_id_has_score (list[str] | SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1 |
            SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2 | Unset):
        evaluations_evaluator_id_has_label (list[str] | SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1 |
            SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2 | Unset):
        evaluations_passed (list[str] | SearchRequestFiltersEvaluationsPassedType1 |
            SearchRequestFiltersEvaluationsPassedType2 | Unset):
        evaluations_score (list[str] | SearchRequestFiltersEvaluationsScoreType1 |
            SearchRequestFiltersEvaluationsScoreType2 | Unset):
        evaluations_state (list[str] | SearchRequestFiltersEvaluationsStateType1 |
            SearchRequestFiltersEvaluationsStateType2 | Unset):
        evaluations_label (list[str] | SearchRequestFiltersEvaluationsLabelType1 |
            SearchRequestFiltersEvaluationsLabelType2 | Unset):
        events_event_type (list[str] | SearchRequestFiltersEventsEventTypeType1 |
            SearchRequestFiltersEventsEventTypeType2 | Unset):
        events_metrics_key (list[str] | SearchRequestFiltersEventsMetricsKeyType1 |
            SearchRequestFiltersEventsMetricsKeyType2 | Unset):
        events_metrics_value (list[str] | SearchRequestFiltersEventsMetricsValueType1 |
            SearchRequestFiltersEventsMetricsValueType2 | Unset):
        events_event_details_key (list[str] | SearchRequestFiltersEventsEventDetailsKeyType1 |
            SearchRequestFiltersEventsEventDetailsKeyType2 | Unset):
        annotations_has_annotation (list[str] | SearchRequestFiltersAnnotationsHasAnnotationType1 |
            SearchRequestFiltersAnnotationsHasAnnotationType2 | Unset):
    """

    topics_topics: list[str] | SearchRequestFiltersTopicsTopicsType1 | SearchRequestFiltersTopicsTopicsType2 | Unset = (
        UNSET
    )
    topics_subtopics: (
        list[str] | SearchRequestFiltersTopicsSubtopicsType1 | SearchRequestFiltersTopicsSubtopicsType2 | Unset
    ) = UNSET
    metadata_user_id: (
        list[str] | SearchRequestFiltersMetadataUserIdType1 | SearchRequestFiltersMetadataUserIdType2 | Unset
    ) = UNSET
    metadata_thread_id: (
        list[str] | SearchRequestFiltersMetadataThreadIdType1 | SearchRequestFiltersMetadataThreadIdType2 | Unset
    ) = UNSET
    metadata_customer_id: (
        list[str] | SearchRequestFiltersMetadataCustomerIdType1 | SearchRequestFiltersMetadataCustomerIdType2 | Unset
    ) = UNSET
    metadata_labels: (
        list[str] | SearchRequestFiltersMetadataLabelsType1 | SearchRequestFiltersMetadataLabelsType2 | Unset
    ) = UNSET
    metadata_key: list[str] | SearchRequestFiltersMetadataKeyType1 | SearchRequestFiltersMetadataKeyType2 | Unset = (
        UNSET
    )
    metadata_value: (
        list[str] | SearchRequestFiltersMetadataValueType1 | SearchRequestFiltersMetadataValueType2 | Unset
    ) = UNSET
    metadata_prompt_ids: (
        list[str] | SearchRequestFiltersMetadataPromptIdsType1 | SearchRequestFiltersMetadataPromptIdsType2 | Unset
    ) = UNSET
    traces_origin: list[str] | SearchRequestFiltersTracesOriginType1 | SearchRequestFiltersTracesOriginType2 | Unset = (
        UNSET
    )
    traces_error: list[str] | SearchRequestFiltersTracesErrorType1 | SearchRequestFiltersTracesErrorType2 | Unset = (
        UNSET
    )
    traces_name: list[str] | SearchRequestFiltersTracesNameType1 | SearchRequestFiltersTracesNameType2 | Unset = UNSET
    spans_type: list[str] | SearchRequestFiltersSpansTypeType1 | SearchRequestFiltersSpansTypeType2 | Unset = UNSET
    spans_model: list[str] | SearchRequestFiltersSpansModelType1 | SearchRequestFiltersSpansModelType2 | Unset = UNSET
    evaluations_evaluator_id: (
        list[str]
        | SearchRequestFiltersEvaluationsEvaluatorIdType1
        | SearchRequestFiltersEvaluationsEvaluatorIdType2
        | Unset
    ) = UNSET
    evaluations_evaluator_id_guardrails_only: (
        list[str]
        | SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
        | SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
        | Unset
    ) = UNSET
    evaluations_evaluator_id_has_passed: (
        list[str]
        | SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1
        | SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2
        | Unset
    ) = UNSET
    evaluations_evaluator_id_has_score: (
        list[str]
        | SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1
        | SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2
        | Unset
    ) = UNSET
    evaluations_evaluator_id_has_label: (
        list[str]
        | SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1
        | SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2
        | Unset
    ) = UNSET
    evaluations_passed: (
        list[str] | SearchRequestFiltersEvaluationsPassedType1 | SearchRequestFiltersEvaluationsPassedType2 | Unset
    ) = UNSET
    evaluations_score: (
        list[str] | SearchRequestFiltersEvaluationsScoreType1 | SearchRequestFiltersEvaluationsScoreType2 | Unset
    ) = UNSET
    evaluations_state: (
        list[str] | SearchRequestFiltersEvaluationsStateType1 | SearchRequestFiltersEvaluationsStateType2 | Unset
    ) = UNSET
    evaluations_label: (
        list[str] | SearchRequestFiltersEvaluationsLabelType1 | SearchRequestFiltersEvaluationsLabelType2 | Unset
    ) = UNSET
    events_event_type: (
        list[str] | SearchRequestFiltersEventsEventTypeType1 | SearchRequestFiltersEventsEventTypeType2 | Unset
    ) = UNSET
    events_metrics_key: (
        list[str] | SearchRequestFiltersEventsMetricsKeyType1 | SearchRequestFiltersEventsMetricsKeyType2 | Unset
    ) = UNSET
    events_metrics_value: (
        list[str] | SearchRequestFiltersEventsMetricsValueType1 | SearchRequestFiltersEventsMetricsValueType2 | Unset
    ) = UNSET
    events_event_details_key: (
        list[str]
        | SearchRequestFiltersEventsEventDetailsKeyType1
        | SearchRequestFiltersEventsEventDetailsKeyType2
        | Unset
    ) = UNSET
    annotations_has_annotation: (
        list[str]
        | SearchRequestFiltersAnnotationsHasAnnotationType1
        | SearchRequestFiltersAnnotationsHasAnnotationType2
        | Unset
    ) = UNSET
    additional_properties: dict[
        str, list[str] | SearchRequestFiltersAdditionalPropertyType1 | SearchRequestFiltersAdditionalPropertyType2
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.search_request_filters_additional_property_type_1 import (
            SearchRequestFiltersAdditionalPropertyType1,
        )
        from ..models.search_request_filters_annotations_has_annotation_type_1 import (
            SearchRequestFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_label_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_passed_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.search_request_filters_evaluations_label_type_1 import SearchRequestFiltersEvaluationsLabelType1
        from ..models.search_request_filters_evaluations_passed_type_1 import SearchRequestFiltersEvaluationsPassedType1
        from ..models.search_request_filters_evaluations_score_type_1 import SearchRequestFiltersEvaluationsScoreType1
        from ..models.search_request_filters_evaluations_state_type_1 import SearchRequestFiltersEvaluationsStateType1
        from ..models.search_request_filters_events_event_details_key_type_1 import (
            SearchRequestFiltersEventsEventDetailsKeyType1,
        )
        from ..models.search_request_filters_events_event_type_type_1 import SearchRequestFiltersEventsEventTypeType1
        from ..models.search_request_filters_events_metrics_key_type_1 import SearchRequestFiltersEventsMetricsKeyType1
        from ..models.search_request_filters_events_metrics_value_type_1 import (
            SearchRequestFiltersEventsMetricsValueType1,
        )
        from ..models.search_request_filters_metadata_customer_id_type_1 import (
            SearchRequestFiltersMetadataCustomerIdType1,
        )
        from ..models.search_request_filters_metadata_key_type_1 import SearchRequestFiltersMetadataKeyType1
        from ..models.search_request_filters_metadata_labels_type_1 import SearchRequestFiltersMetadataLabelsType1
        from ..models.search_request_filters_metadata_prompt_ids_type_1 import (
            SearchRequestFiltersMetadataPromptIdsType1,
        )
        from ..models.search_request_filters_metadata_thread_id_type_1 import SearchRequestFiltersMetadataThreadIdType1
        from ..models.search_request_filters_metadata_user_id_type_1 import SearchRequestFiltersMetadataUserIdType1
        from ..models.search_request_filters_metadata_value_type_1 import SearchRequestFiltersMetadataValueType1
        from ..models.search_request_filters_spans_model_type_1 import SearchRequestFiltersSpansModelType1
        from ..models.search_request_filters_spans_type_type_1 import SearchRequestFiltersSpansTypeType1
        from ..models.search_request_filters_topics_subtopics_type_1 import SearchRequestFiltersTopicsSubtopicsType1
        from ..models.search_request_filters_topics_topics_type_1 import SearchRequestFiltersTopicsTopicsType1
        from ..models.search_request_filters_traces_error_type_1 import SearchRequestFiltersTracesErrorType1
        from ..models.search_request_filters_traces_name_type_1 import SearchRequestFiltersTracesNameType1
        from ..models.search_request_filters_traces_origin_type_1 import SearchRequestFiltersTracesOriginType1

        topics_topics: dict[str, Any] | list[str] | Unset
        if isinstance(self.topics_topics, Unset):
            topics_topics = UNSET
        elif isinstance(self.topics_topics, list):
            topics_topics = self.topics_topics

        elif isinstance(self.topics_topics, SearchRequestFiltersTopicsTopicsType1):
            topics_topics = self.topics_topics.to_dict()
        else:
            topics_topics = self.topics_topics.to_dict()

        topics_subtopics: dict[str, Any] | list[str] | Unset
        if isinstance(self.topics_subtopics, Unset):
            topics_subtopics = UNSET
        elif isinstance(self.topics_subtopics, list):
            topics_subtopics = self.topics_subtopics

        elif isinstance(self.topics_subtopics, SearchRequestFiltersTopicsSubtopicsType1):
            topics_subtopics = self.topics_subtopics.to_dict()
        else:
            topics_subtopics = self.topics_subtopics.to_dict()

        metadata_user_id: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_user_id, Unset):
            metadata_user_id = UNSET
        elif isinstance(self.metadata_user_id, list):
            metadata_user_id = self.metadata_user_id

        elif isinstance(self.metadata_user_id, SearchRequestFiltersMetadataUserIdType1):
            metadata_user_id = self.metadata_user_id.to_dict()
        else:
            metadata_user_id = self.metadata_user_id.to_dict()

        metadata_thread_id: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_thread_id, Unset):
            metadata_thread_id = UNSET
        elif isinstance(self.metadata_thread_id, list):
            metadata_thread_id = self.metadata_thread_id

        elif isinstance(self.metadata_thread_id, SearchRequestFiltersMetadataThreadIdType1):
            metadata_thread_id = self.metadata_thread_id.to_dict()
        else:
            metadata_thread_id = self.metadata_thread_id.to_dict()

        metadata_customer_id: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_customer_id, Unset):
            metadata_customer_id = UNSET
        elif isinstance(self.metadata_customer_id, list):
            metadata_customer_id = self.metadata_customer_id

        elif isinstance(self.metadata_customer_id, SearchRequestFiltersMetadataCustomerIdType1):
            metadata_customer_id = self.metadata_customer_id.to_dict()
        else:
            metadata_customer_id = self.metadata_customer_id.to_dict()

        metadata_labels: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_labels, Unset):
            metadata_labels = UNSET
        elif isinstance(self.metadata_labels, list):
            metadata_labels = self.metadata_labels

        elif isinstance(self.metadata_labels, SearchRequestFiltersMetadataLabelsType1):
            metadata_labels = self.metadata_labels.to_dict()
        else:
            metadata_labels = self.metadata_labels.to_dict()

        metadata_key: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_key, Unset):
            metadata_key = UNSET
        elif isinstance(self.metadata_key, list):
            metadata_key = self.metadata_key

        elif isinstance(self.metadata_key, SearchRequestFiltersMetadataKeyType1):
            metadata_key = self.metadata_key.to_dict()
        else:
            metadata_key = self.metadata_key.to_dict()

        metadata_value: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_value, Unset):
            metadata_value = UNSET
        elif isinstance(self.metadata_value, list):
            metadata_value = self.metadata_value

        elif isinstance(self.metadata_value, SearchRequestFiltersMetadataValueType1):
            metadata_value = self.metadata_value.to_dict()
        else:
            metadata_value = self.metadata_value.to_dict()

        metadata_prompt_ids: dict[str, Any] | list[str] | Unset
        if isinstance(self.metadata_prompt_ids, Unset):
            metadata_prompt_ids = UNSET
        elif isinstance(self.metadata_prompt_ids, list):
            metadata_prompt_ids = self.metadata_prompt_ids

        elif isinstance(self.metadata_prompt_ids, SearchRequestFiltersMetadataPromptIdsType1):
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()
        else:
            metadata_prompt_ids = self.metadata_prompt_ids.to_dict()

        traces_origin: dict[str, Any] | list[str] | Unset
        if isinstance(self.traces_origin, Unset):
            traces_origin = UNSET
        elif isinstance(self.traces_origin, list):
            traces_origin = self.traces_origin

        elif isinstance(self.traces_origin, SearchRequestFiltersTracesOriginType1):
            traces_origin = self.traces_origin.to_dict()
        else:
            traces_origin = self.traces_origin.to_dict()

        traces_error: dict[str, Any] | list[str] | Unset
        if isinstance(self.traces_error, Unset):
            traces_error = UNSET
        elif isinstance(self.traces_error, list):
            traces_error = self.traces_error

        elif isinstance(self.traces_error, SearchRequestFiltersTracesErrorType1):
            traces_error = self.traces_error.to_dict()
        else:
            traces_error = self.traces_error.to_dict()

        traces_name: dict[str, Any] | list[str] | Unset
        if isinstance(self.traces_name, Unset):
            traces_name = UNSET
        elif isinstance(self.traces_name, list):
            traces_name = self.traces_name

        elif isinstance(self.traces_name, SearchRequestFiltersTracesNameType1):
            traces_name = self.traces_name.to_dict()
        else:
            traces_name = self.traces_name.to_dict()

        spans_type: dict[str, Any] | list[str] | Unset
        if isinstance(self.spans_type, Unset):
            spans_type = UNSET
        elif isinstance(self.spans_type, list):
            spans_type = self.spans_type

        elif isinstance(self.spans_type, SearchRequestFiltersSpansTypeType1):
            spans_type = self.spans_type.to_dict()
        else:
            spans_type = self.spans_type.to_dict()

        spans_model: dict[str, Any] | list[str] | Unset
        if isinstance(self.spans_model, Unset):
            spans_model = UNSET
        elif isinstance(self.spans_model, list):
            spans_model = self.spans_model

        elif isinstance(self.spans_model, SearchRequestFiltersSpansModelType1):
            spans_model = self.spans_model.to_dict()
        else:
            spans_model = self.spans_model.to_dict()

        evaluations_evaluator_id: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_evaluator_id, Unset):
            evaluations_evaluator_id = UNSET
        elif isinstance(self.evaluations_evaluator_id, list):
            evaluations_evaluator_id = self.evaluations_evaluator_id

        elif isinstance(self.evaluations_evaluator_id, SearchRequestFiltersEvaluationsEvaluatorIdType1):
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()
        else:
            evaluations_evaluator_id = self.evaluations_evaluator_id.to_dict()

        evaluations_evaluator_id_guardrails_only: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_evaluator_id_guardrails_only, Unset):
            evaluations_evaluator_id_guardrails_only = UNSET
        elif isinstance(self.evaluations_evaluator_id_guardrails_only, list):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only

        elif isinstance(
            self.evaluations_evaluator_id_guardrails_only, SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
        ):
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()
        else:
            evaluations_evaluator_id_guardrails_only = self.evaluations_evaluator_id_guardrails_only.to_dict()

        evaluations_evaluator_id_has_passed: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_evaluator_id_has_passed, Unset):
            evaluations_evaluator_id_has_passed = UNSET
        elif isinstance(self.evaluations_evaluator_id_has_passed, list):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed

        elif isinstance(
            self.evaluations_evaluator_id_has_passed, SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1
        ):
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()
        else:
            evaluations_evaluator_id_has_passed = self.evaluations_evaluator_id_has_passed.to_dict()

        evaluations_evaluator_id_has_score: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_evaluator_id_has_score, Unset):
            evaluations_evaluator_id_has_score = UNSET
        elif isinstance(self.evaluations_evaluator_id_has_score, list):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score

        elif isinstance(
            self.evaluations_evaluator_id_has_score, SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1
        ):
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()
        else:
            evaluations_evaluator_id_has_score = self.evaluations_evaluator_id_has_score.to_dict()

        evaluations_evaluator_id_has_label: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_evaluator_id_has_label, Unset):
            evaluations_evaluator_id_has_label = UNSET
        elif isinstance(self.evaluations_evaluator_id_has_label, list):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label

        elif isinstance(
            self.evaluations_evaluator_id_has_label, SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1
        ):
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()
        else:
            evaluations_evaluator_id_has_label = self.evaluations_evaluator_id_has_label.to_dict()

        evaluations_passed: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_passed, Unset):
            evaluations_passed = UNSET
        elif isinstance(self.evaluations_passed, list):
            evaluations_passed = self.evaluations_passed

        elif isinstance(self.evaluations_passed, SearchRequestFiltersEvaluationsPassedType1):
            evaluations_passed = self.evaluations_passed.to_dict()
        else:
            evaluations_passed = self.evaluations_passed.to_dict()

        evaluations_score: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_score, Unset):
            evaluations_score = UNSET
        elif isinstance(self.evaluations_score, list):
            evaluations_score = self.evaluations_score

        elif isinstance(self.evaluations_score, SearchRequestFiltersEvaluationsScoreType1):
            evaluations_score = self.evaluations_score.to_dict()
        else:
            evaluations_score = self.evaluations_score.to_dict()

        evaluations_state: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_state, Unset):
            evaluations_state = UNSET
        elif isinstance(self.evaluations_state, list):
            evaluations_state = self.evaluations_state

        elif isinstance(self.evaluations_state, SearchRequestFiltersEvaluationsStateType1):
            evaluations_state = self.evaluations_state.to_dict()
        else:
            evaluations_state = self.evaluations_state.to_dict()

        evaluations_label: dict[str, Any] | list[str] | Unset
        if isinstance(self.evaluations_label, Unset):
            evaluations_label = UNSET
        elif isinstance(self.evaluations_label, list):
            evaluations_label = self.evaluations_label

        elif isinstance(self.evaluations_label, SearchRequestFiltersEvaluationsLabelType1):
            evaluations_label = self.evaluations_label.to_dict()
        else:
            evaluations_label = self.evaluations_label.to_dict()

        events_event_type: dict[str, Any] | list[str] | Unset
        if isinstance(self.events_event_type, Unset):
            events_event_type = UNSET
        elif isinstance(self.events_event_type, list):
            events_event_type = self.events_event_type

        elif isinstance(self.events_event_type, SearchRequestFiltersEventsEventTypeType1):
            events_event_type = self.events_event_type.to_dict()
        else:
            events_event_type = self.events_event_type.to_dict()

        events_metrics_key: dict[str, Any] | list[str] | Unset
        if isinstance(self.events_metrics_key, Unset):
            events_metrics_key = UNSET
        elif isinstance(self.events_metrics_key, list):
            events_metrics_key = self.events_metrics_key

        elif isinstance(self.events_metrics_key, SearchRequestFiltersEventsMetricsKeyType1):
            events_metrics_key = self.events_metrics_key.to_dict()
        else:
            events_metrics_key = self.events_metrics_key.to_dict()

        events_metrics_value: dict[str, Any] | list[str] | Unset
        if isinstance(self.events_metrics_value, Unset):
            events_metrics_value = UNSET
        elif isinstance(self.events_metrics_value, list):
            events_metrics_value = self.events_metrics_value

        elif isinstance(self.events_metrics_value, SearchRequestFiltersEventsMetricsValueType1):
            events_metrics_value = self.events_metrics_value.to_dict()
        else:
            events_metrics_value = self.events_metrics_value.to_dict()

        events_event_details_key: dict[str, Any] | list[str] | Unset
        if isinstance(self.events_event_details_key, Unset):
            events_event_details_key = UNSET
        elif isinstance(self.events_event_details_key, list):
            events_event_details_key = self.events_event_details_key

        elif isinstance(self.events_event_details_key, SearchRequestFiltersEventsEventDetailsKeyType1):
            events_event_details_key = self.events_event_details_key.to_dict()
        else:
            events_event_details_key = self.events_event_details_key.to_dict()

        annotations_has_annotation: dict[str, Any] | list[str] | Unset
        if isinstance(self.annotations_has_annotation, Unset):
            annotations_has_annotation = UNSET
        elif isinstance(self.annotations_has_annotation, list):
            annotations_has_annotation = self.annotations_has_annotation

        elif isinstance(self.annotations_has_annotation, SearchRequestFiltersAnnotationsHasAnnotationType1):
            annotations_has_annotation = self.annotations_has_annotation.to_dict()
        else:
            annotations_has_annotation = self.annotations_has_annotation.to_dict()

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, list):
                field_dict[prop_name] = prop

            elif isinstance(prop, SearchRequestFiltersAdditionalPropertyType1):
                field_dict[prop_name] = prop.to_dict()
            else:
                field_dict[prop_name] = prop.to_dict()

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
        if traces_name is not UNSET:
            field_dict["traces.name"] = traces_name
        if spans_type is not UNSET:
            field_dict["spans.type"] = spans_type
        if spans_model is not UNSET:
            field_dict["spans.model"] = spans_model
        if evaluations_evaluator_id is not UNSET:
            field_dict["evaluations.evaluator_id"] = evaluations_evaluator_id
        if evaluations_evaluator_id_guardrails_only is not UNSET:
            field_dict["evaluations.evaluator_id.guardrails_only"] = evaluations_evaluator_id_guardrails_only
        if evaluations_evaluator_id_has_passed is not UNSET:
            field_dict["evaluations.evaluator_id.has_passed"] = evaluations_evaluator_id_has_passed
        if evaluations_evaluator_id_has_score is not UNSET:
            field_dict["evaluations.evaluator_id.has_score"] = evaluations_evaluator_id_has_score
        if evaluations_evaluator_id_has_label is not UNSET:
            field_dict["evaluations.evaluator_id.has_label"] = evaluations_evaluator_id_has_label
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
        from ..models.search_request_filters_additional_property_type_1 import (
            SearchRequestFiltersAdditionalPropertyType1,
        )
        from ..models.search_request_filters_additional_property_type_2 import (
            SearchRequestFiltersAdditionalPropertyType2,
        )
        from ..models.search_request_filters_annotations_has_annotation_type_1 import (
            SearchRequestFiltersAnnotationsHasAnnotationType1,
        )
        from ..models.search_request_filters_annotations_has_annotation_type_2 import (
            SearchRequestFiltersAnnotationsHasAnnotationType2,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_guardrails_only_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_guardrails_only_type_2 import (
            SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_label_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_label_type_2 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_passed_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_passed_type_2 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_has_score_type_2 import (
            SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_type_1 import (
            SearchRequestFiltersEvaluationsEvaluatorIdType1,
        )
        from ..models.search_request_filters_evaluations_evaluator_id_type_2 import (
            SearchRequestFiltersEvaluationsEvaluatorIdType2,
        )
        from ..models.search_request_filters_evaluations_label_type_1 import SearchRequestFiltersEvaluationsLabelType1
        from ..models.search_request_filters_evaluations_label_type_2 import SearchRequestFiltersEvaluationsLabelType2
        from ..models.search_request_filters_evaluations_passed_type_1 import SearchRequestFiltersEvaluationsPassedType1
        from ..models.search_request_filters_evaluations_passed_type_2 import SearchRequestFiltersEvaluationsPassedType2
        from ..models.search_request_filters_evaluations_score_type_1 import SearchRequestFiltersEvaluationsScoreType1
        from ..models.search_request_filters_evaluations_score_type_2 import SearchRequestFiltersEvaluationsScoreType2
        from ..models.search_request_filters_evaluations_state_type_1 import SearchRequestFiltersEvaluationsStateType1
        from ..models.search_request_filters_evaluations_state_type_2 import SearchRequestFiltersEvaluationsStateType2
        from ..models.search_request_filters_events_event_details_key_type_1 import (
            SearchRequestFiltersEventsEventDetailsKeyType1,
        )
        from ..models.search_request_filters_events_event_details_key_type_2 import (
            SearchRequestFiltersEventsEventDetailsKeyType2,
        )
        from ..models.search_request_filters_events_event_type_type_1 import SearchRequestFiltersEventsEventTypeType1
        from ..models.search_request_filters_events_event_type_type_2 import SearchRequestFiltersEventsEventTypeType2
        from ..models.search_request_filters_events_metrics_key_type_1 import SearchRequestFiltersEventsMetricsKeyType1
        from ..models.search_request_filters_events_metrics_key_type_2 import SearchRequestFiltersEventsMetricsKeyType2
        from ..models.search_request_filters_events_metrics_value_type_1 import (
            SearchRequestFiltersEventsMetricsValueType1,
        )
        from ..models.search_request_filters_events_metrics_value_type_2 import (
            SearchRequestFiltersEventsMetricsValueType2,
        )
        from ..models.search_request_filters_metadata_customer_id_type_1 import (
            SearchRequestFiltersMetadataCustomerIdType1,
        )
        from ..models.search_request_filters_metadata_customer_id_type_2 import (
            SearchRequestFiltersMetadataCustomerIdType2,
        )
        from ..models.search_request_filters_metadata_key_type_1 import SearchRequestFiltersMetadataKeyType1
        from ..models.search_request_filters_metadata_key_type_2 import SearchRequestFiltersMetadataKeyType2
        from ..models.search_request_filters_metadata_labels_type_1 import SearchRequestFiltersMetadataLabelsType1
        from ..models.search_request_filters_metadata_labels_type_2 import SearchRequestFiltersMetadataLabelsType2
        from ..models.search_request_filters_metadata_prompt_ids_type_1 import (
            SearchRequestFiltersMetadataPromptIdsType1,
        )
        from ..models.search_request_filters_metadata_prompt_ids_type_2 import (
            SearchRequestFiltersMetadataPromptIdsType2,
        )
        from ..models.search_request_filters_metadata_thread_id_type_1 import SearchRequestFiltersMetadataThreadIdType1
        from ..models.search_request_filters_metadata_thread_id_type_2 import SearchRequestFiltersMetadataThreadIdType2
        from ..models.search_request_filters_metadata_user_id_type_1 import SearchRequestFiltersMetadataUserIdType1
        from ..models.search_request_filters_metadata_user_id_type_2 import SearchRequestFiltersMetadataUserIdType2
        from ..models.search_request_filters_metadata_value_type_1 import SearchRequestFiltersMetadataValueType1
        from ..models.search_request_filters_metadata_value_type_2 import SearchRequestFiltersMetadataValueType2
        from ..models.search_request_filters_spans_model_type_1 import SearchRequestFiltersSpansModelType1
        from ..models.search_request_filters_spans_model_type_2 import SearchRequestFiltersSpansModelType2
        from ..models.search_request_filters_spans_type_type_1 import SearchRequestFiltersSpansTypeType1
        from ..models.search_request_filters_spans_type_type_2 import SearchRequestFiltersSpansTypeType2
        from ..models.search_request_filters_topics_subtopics_type_1 import SearchRequestFiltersTopicsSubtopicsType1
        from ..models.search_request_filters_topics_subtopics_type_2 import SearchRequestFiltersTopicsSubtopicsType2
        from ..models.search_request_filters_topics_topics_type_1 import SearchRequestFiltersTopicsTopicsType1
        from ..models.search_request_filters_topics_topics_type_2 import SearchRequestFiltersTopicsTopicsType2
        from ..models.search_request_filters_traces_error_type_1 import SearchRequestFiltersTracesErrorType1
        from ..models.search_request_filters_traces_error_type_2 import SearchRequestFiltersTracesErrorType2
        from ..models.search_request_filters_traces_name_type_1 import SearchRequestFiltersTracesNameType1
        from ..models.search_request_filters_traces_name_type_2 import SearchRequestFiltersTracesNameType2
        from ..models.search_request_filters_traces_origin_type_1 import SearchRequestFiltersTracesOriginType1
        from ..models.search_request_filters_traces_origin_type_2 import SearchRequestFiltersTracesOriginType2

        d = dict(src_dict)

        def _parse_topics_topics(
            data: object,
        ) -> list[str] | SearchRequestFiltersTopicsTopicsType1 | SearchRequestFiltersTopicsTopicsType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                topics_topics_type_1 = SearchRequestFiltersTopicsTopicsType1.from_dict(data)

                return topics_topics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_topics_type_2 = SearchRequestFiltersTopicsTopicsType2.from_dict(data)

            return topics_topics_type_2

        topics_topics = _parse_topics_topics(d.pop("topics.topics", UNSET))

        def _parse_topics_subtopics(
            data: object,
        ) -> list[str] | SearchRequestFiltersTopicsSubtopicsType1 | SearchRequestFiltersTopicsSubtopicsType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                topics_subtopics_type_1 = SearchRequestFiltersTopicsSubtopicsType1.from_dict(data)

                return topics_subtopics_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            topics_subtopics_type_2 = SearchRequestFiltersTopicsSubtopicsType2.from_dict(data)

            return topics_subtopics_type_2

        topics_subtopics = _parse_topics_subtopics(d.pop("topics.subtopics", UNSET))

        def _parse_metadata_user_id(
            data: object,
        ) -> list[str] | SearchRequestFiltersMetadataUserIdType1 | SearchRequestFiltersMetadataUserIdType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                metadata_user_id_type_1 = SearchRequestFiltersMetadataUserIdType1.from_dict(data)

                return metadata_user_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_user_id_type_2 = SearchRequestFiltersMetadataUserIdType2.from_dict(data)

            return metadata_user_id_type_2

        metadata_user_id = _parse_metadata_user_id(d.pop("metadata.user_id", UNSET))

        def _parse_metadata_thread_id(
            data: object,
        ) -> list[str] | SearchRequestFiltersMetadataThreadIdType1 | SearchRequestFiltersMetadataThreadIdType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                metadata_thread_id_type_1 = SearchRequestFiltersMetadataThreadIdType1.from_dict(data)

                return metadata_thread_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_thread_id_type_2 = SearchRequestFiltersMetadataThreadIdType2.from_dict(data)

            return metadata_thread_id_type_2

        metadata_thread_id = _parse_metadata_thread_id(d.pop("metadata.thread_id", UNSET))

        def _parse_metadata_customer_id(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersMetadataCustomerIdType1
            | SearchRequestFiltersMetadataCustomerIdType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                metadata_customer_id_type_1 = SearchRequestFiltersMetadataCustomerIdType1.from_dict(data)

                return metadata_customer_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_customer_id_type_2 = SearchRequestFiltersMetadataCustomerIdType2.from_dict(data)

            return metadata_customer_id_type_2

        metadata_customer_id = _parse_metadata_customer_id(d.pop("metadata.customer_id", UNSET))

        def _parse_metadata_labels(
            data: object,
        ) -> list[str] | SearchRequestFiltersMetadataLabelsType1 | SearchRequestFiltersMetadataLabelsType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                metadata_labels_type_1 = SearchRequestFiltersMetadataLabelsType1.from_dict(data)

                return metadata_labels_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_labels_type_2 = SearchRequestFiltersMetadataLabelsType2.from_dict(data)

            return metadata_labels_type_2

        metadata_labels = _parse_metadata_labels(d.pop("metadata.labels", UNSET))

        def _parse_metadata_key(
            data: object,
        ) -> list[str] | SearchRequestFiltersMetadataKeyType1 | SearchRequestFiltersMetadataKeyType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                metadata_key_type_1 = SearchRequestFiltersMetadataKeyType1.from_dict(data)

                return metadata_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_key_type_2 = SearchRequestFiltersMetadataKeyType2.from_dict(data)

            return metadata_key_type_2

        metadata_key = _parse_metadata_key(d.pop("metadata.key", UNSET))

        def _parse_metadata_value(
            data: object,
        ) -> list[str] | SearchRequestFiltersMetadataValueType1 | SearchRequestFiltersMetadataValueType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                metadata_value_type_1 = SearchRequestFiltersMetadataValueType1.from_dict(data)

                return metadata_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_value_type_2 = SearchRequestFiltersMetadataValueType2.from_dict(data)

            return metadata_value_type_2

        metadata_value = _parse_metadata_value(d.pop("metadata.value", UNSET))

        def _parse_metadata_prompt_ids(
            data: object,
        ) -> (
            list[str] | SearchRequestFiltersMetadataPromptIdsType1 | SearchRequestFiltersMetadataPromptIdsType2 | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                metadata_prompt_ids_type_1 = SearchRequestFiltersMetadataPromptIdsType1.from_dict(data)

                return metadata_prompt_ids_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            metadata_prompt_ids_type_2 = SearchRequestFiltersMetadataPromptIdsType2.from_dict(data)

            return metadata_prompt_ids_type_2

        metadata_prompt_ids = _parse_metadata_prompt_ids(d.pop("metadata.prompt_ids", UNSET))

        def _parse_traces_origin(
            data: object,
        ) -> list[str] | SearchRequestFiltersTracesOriginType1 | SearchRequestFiltersTracesOriginType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                traces_origin_type_1 = SearchRequestFiltersTracesOriginType1.from_dict(data)

                return traces_origin_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_origin_type_2 = SearchRequestFiltersTracesOriginType2.from_dict(data)

            return traces_origin_type_2

        traces_origin = _parse_traces_origin(d.pop("traces.origin", UNSET))

        def _parse_traces_error(
            data: object,
        ) -> list[str] | SearchRequestFiltersTracesErrorType1 | SearchRequestFiltersTracesErrorType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                traces_error_type_1 = SearchRequestFiltersTracesErrorType1.from_dict(data)

                return traces_error_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_error_type_2 = SearchRequestFiltersTracesErrorType2.from_dict(data)

            return traces_error_type_2

        traces_error = _parse_traces_error(d.pop("traces.error", UNSET))

        def _parse_traces_name(
            data: object,
        ) -> list[str] | SearchRequestFiltersTracesNameType1 | SearchRequestFiltersTracesNameType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                traces_name_type_1 = SearchRequestFiltersTracesNameType1.from_dict(data)

                return traces_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            traces_name_type_2 = SearchRequestFiltersTracesNameType2.from_dict(data)

            return traces_name_type_2

        traces_name = _parse_traces_name(d.pop("traces.name", UNSET))

        def _parse_spans_type(
            data: object,
        ) -> list[str] | SearchRequestFiltersSpansTypeType1 | SearchRequestFiltersSpansTypeType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                spans_type_type_1 = SearchRequestFiltersSpansTypeType1.from_dict(data)

                return spans_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_type_type_2 = SearchRequestFiltersSpansTypeType2.from_dict(data)

            return spans_type_type_2

        spans_type = _parse_spans_type(d.pop("spans.type", UNSET))

        def _parse_spans_model(
            data: object,
        ) -> list[str] | SearchRequestFiltersSpansModelType1 | SearchRequestFiltersSpansModelType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                spans_model_type_1 = SearchRequestFiltersSpansModelType1.from_dict(data)

                return spans_model_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            spans_model_type_2 = SearchRequestFiltersSpansModelType2.from_dict(data)

            return spans_model_type_2

        spans_model = _parse_spans_model(d.pop("spans.model", UNSET))

        def _parse_evaluations_evaluator_id(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEvaluationsEvaluatorIdType1
            | SearchRequestFiltersEvaluationsEvaluatorIdType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                evaluations_evaluator_id_type_1 = SearchRequestFiltersEvaluationsEvaluatorIdType1.from_dict(data)

                return evaluations_evaluator_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_type_2 = SearchRequestFiltersEvaluationsEvaluatorIdType2.from_dict(data)

            return evaluations_evaluator_id_type_2

        evaluations_evaluator_id = _parse_evaluations_evaluator_id(d.pop("evaluations.evaluator_id", UNSET))

        def _parse_evaluations_evaluator_id_guardrails_only(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1
            | SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                    SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType1.from_dict(data)
                )

                return evaluations_evaluator_id_guardrails_only_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_guardrails_only_type_2 = (
                SearchRequestFiltersEvaluationsEvaluatorIdGuardrailsOnlyType2.from_dict(data)
            )

            return evaluations_evaluator_id_guardrails_only_type_2

        evaluations_evaluator_id_guardrails_only = _parse_evaluations_evaluator_id_guardrails_only(
            d.pop("evaluations.evaluator_id.guardrails_only", UNSET)
        )

        def _parse_evaluations_evaluator_id_has_passed(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1
            | SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                    SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_passed_type_2 = (
                SearchRequestFiltersEvaluationsEvaluatorIdHasPassedType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_passed_type_2

        evaluations_evaluator_id_has_passed = _parse_evaluations_evaluator_id_has_passed(
            d.pop("evaluations.evaluator_id.has_passed", UNSET)
        )

        def _parse_evaluations_evaluator_id_has_score(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1
            | SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                    SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_score_type_2 = (
                SearchRequestFiltersEvaluationsEvaluatorIdHasScoreType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_score_type_2

        evaluations_evaluator_id_has_score = _parse_evaluations_evaluator_id_has_score(
            d.pop("evaluations.evaluator_id.has_score", UNSET)
        )

        def _parse_evaluations_evaluator_id_has_label(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1
            | SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                    SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType1.from_dict(data)
                )

                return evaluations_evaluator_id_has_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_evaluator_id_has_label_type_2 = (
                SearchRequestFiltersEvaluationsEvaluatorIdHasLabelType2.from_dict(data)
            )

            return evaluations_evaluator_id_has_label_type_2

        evaluations_evaluator_id_has_label = _parse_evaluations_evaluator_id_has_label(
            d.pop("evaluations.evaluator_id.has_label", UNSET)
        )

        def _parse_evaluations_passed(
            data: object,
        ) -> (
            list[str] | SearchRequestFiltersEvaluationsPassedType1 | SearchRequestFiltersEvaluationsPassedType2 | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                evaluations_passed_type_1 = SearchRequestFiltersEvaluationsPassedType1.from_dict(data)

                return evaluations_passed_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_passed_type_2 = SearchRequestFiltersEvaluationsPassedType2.from_dict(data)

            return evaluations_passed_type_2

        evaluations_passed = _parse_evaluations_passed(d.pop("evaluations.passed", UNSET))

        def _parse_evaluations_score(
            data: object,
        ) -> list[str] | SearchRequestFiltersEvaluationsScoreType1 | SearchRequestFiltersEvaluationsScoreType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                evaluations_score_type_1 = SearchRequestFiltersEvaluationsScoreType1.from_dict(data)

                return evaluations_score_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_score_type_2 = SearchRequestFiltersEvaluationsScoreType2.from_dict(data)

            return evaluations_score_type_2

        evaluations_score = _parse_evaluations_score(d.pop("evaluations.score", UNSET))

        def _parse_evaluations_state(
            data: object,
        ) -> list[str] | SearchRequestFiltersEvaluationsStateType1 | SearchRequestFiltersEvaluationsStateType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                evaluations_state_type_1 = SearchRequestFiltersEvaluationsStateType1.from_dict(data)

                return evaluations_state_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_state_type_2 = SearchRequestFiltersEvaluationsStateType2.from_dict(data)

            return evaluations_state_type_2

        evaluations_state = _parse_evaluations_state(d.pop("evaluations.state", UNSET))

        def _parse_evaluations_label(
            data: object,
        ) -> list[str] | SearchRequestFiltersEvaluationsLabelType1 | SearchRequestFiltersEvaluationsLabelType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                evaluations_label_type_1 = SearchRequestFiltersEvaluationsLabelType1.from_dict(data)

                return evaluations_label_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            evaluations_label_type_2 = SearchRequestFiltersEvaluationsLabelType2.from_dict(data)

            return evaluations_label_type_2

        evaluations_label = _parse_evaluations_label(d.pop("evaluations.label", UNSET))

        def _parse_events_event_type(
            data: object,
        ) -> list[str] | SearchRequestFiltersEventsEventTypeType1 | SearchRequestFiltersEventsEventTypeType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                events_event_type_type_1 = SearchRequestFiltersEventsEventTypeType1.from_dict(data)

                return events_event_type_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_type_type_2 = SearchRequestFiltersEventsEventTypeType2.from_dict(data)

            return events_event_type_type_2

        events_event_type = _parse_events_event_type(d.pop("events.event_type", UNSET))

        def _parse_events_metrics_key(
            data: object,
        ) -> list[str] | SearchRequestFiltersEventsMetricsKeyType1 | SearchRequestFiltersEventsMetricsKeyType2 | Unset:
            if isinstance(data, Unset):
                return data
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
                events_metrics_key_type_1 = SearchRequestFiltersEventsMetricsKeyType1.from_dict(data)

                return events_metrics_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_key_type_2 = SearchRequestFiltersEventsMetricsKeyType2.from_dict(data)

            return events_metrics_key_type_2

        events_metrics_key = _parse_events_metrics_key(d.pop("events.metrics.key", UNSET))

        def _parse_events_metrics_value(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEventsMetricsValueType1
            | SearchRequestFiltersEventsMetricsValueType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                events_metrics_value_type_1 = SearchRequestFiltersEventsMetricsValueType1.from_dict(data)

                return events_metrics_value_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_metrics_value_type_2 = SearchRequestFiltersEventsMetricsValueType2.from_dict(data)

            return events_metrics_value_type_2

        events_metrics_value = _parse_events_metrics_value(d.pop("events.metrics.value", UNSET))

        def _parse_events_event_details_key(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersEventsEventDetailsKeyType1
            | SearchRequestFiltersEventsEventDetailsKeyType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                events_event_details_key_type_1 = SearchRequestFiltersEventsEventDetailsKeyType1.from_dict(data)

                return events_event_details_key_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            events_event_details_key_type_2 = SearchRequestFiltersEventsEventDetailsKeyType2.from_dict(data)

            return events_event_details_key_type_2

        events_event_details_key = _parse_events_event_details_key(d.pop("events.event_details.key", UNSET))

        def _parse_annotations_has_annotation(
            data: object,
        ) -> (
            list[str]
            | SearchRequestFiltersAnnotationsHasAnnotationType1
            | SearchRequestFiltersAnnotationsHasAnnotationType2
            | Unset
        ):
            if isinstance(data, Unset):
                return data
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
                annotations_has_annotation_type_1 = SearchRequestFiltersAnnotationsHasAnnotationType1.from_dict(data)

                return annotations_has_annotation_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            annotations_has_annotation_type_2 = SearchRequestFiltersAnnotationsHasAnnotationType2.from_dict(data)

            return annotations_has_annotation_type_2

        annotations_has_annotation = _parse_annotations_has_annotation(d.pop("annotations.hasAnnotation", UNSET))

        search_request_filters = cls(
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

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> list[str] | SearchRequestFiltersAdditionalPropertyType1 | SearchRequestFiltersAdditionalPropertyType2:
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_0 = cast(list[str], data)

                    return additional_property_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_1 = SearchRequestFiltersAdditionalPropertyType1.from_dict(data)

                    return additional_property_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                additional_property_type_2 = SearchRequestFiltersAdditionalPropertyType2.from_dict(data)

                return additional_property_type_2

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        search_request_filters.additional_properties = additional_properties
        return search_request_filters

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> list[str] | SearchRequestFiltersAdditionalPropertyType1 | SearchRequestFiltersAdditionalPropertyType2:
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: list[str] | SearchRequestFiltersAdditionalPropertyType1 | SearchRequestFiltersAdditionalPropertyType2,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
