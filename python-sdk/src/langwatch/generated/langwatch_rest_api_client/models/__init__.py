"""Contains all the data models used in inputs/outputs"""

from .annotation import Annotation
from .dataset_post_entries import DatasetPostEntries
from .dataset_post_entries_entries_item import DatasetPostEntriesEntriesItem
from .delete_api_annotations_id_response_200 import DeleteApiAnnotationsIdResponse200
from .delete_api_prompts_by_id_response_200 import DeleteApiPromptsByIdResponse200
from .delete_api_prompts_by_id_response_400 import DeleteApiPromptsByIdResponse400
from .delete_api_prompts_by_id_response_400_error import DeleteApiPromptsByIdResponse400Error
from .delete_api_prompts_by_id_response_401 import DeleteApiPromptsByIdResponse401
from .delete_api_prompts_by_id_response_401_error import DeleteApiPromptsByIdResponse401Error
from .delete_api_prompts_by_id_response_404 import DeleteApiPromptsByIdResponse404
from .delete_api_prompts_by_id_response_500 import DeleteApiPromptsByIdResponse500
from .error import Error
from .evaluation import Evaluation
from .evaluation_timestamps import EvaluationTimestamps
from .get_api_dataset_by_slug_or_id_response_200 import GetApiDatasetBySlugOrIdResponse200
from .get_api_dataset_by_slug_or_id_response_200_data_item import GetApiDatasetBySlugOrIdResponse200DataItem
from .get_api_dataset_by_slug_or_id_response_200_data_item_entry import GetApiDatasetBySlugOrIdResponse200DataItemEntry
from .get_api_dataset_by_slug_or_id_response_400 import GetApiDatasetBySlugOrIdResponse400
from .get_api_dataset_by_slug_or_id_response_401 import GetApiDatasetBySlugOrIdResponse401
from .get_api_dataset_by_slug_or_id_response_404 import GetApiDatasetBySlugOrIdResponse404
from .get_api_dataset_by_slug_or_id_response_422 import GetApiDatasetBySlugOrIdResponse422
from .get_api_dataset_by_slug_or_id_response_500 import GetApiDatasetBySlugOrIdResponse500
from .get_api_prompts_by_id_response_200 import GetApiPromptsByIdResponse200
from .get_api_prompts_by_id_response_200_messages_item import GetApiPromptsByIdResponse200MessagesItem
from .get_api_prompts_by_id_response_200_messages_item_role import GetApiPromptsByIdResponse200MessagesItemRole
from .get_api_prompts_by_id_response_200_response_format_type_0 import GetApiPromptsByIdResponse200ResponseFormatType0
from .get_api_prompts_by_id_response_200_response_format_type_0_json_schema import (
    GetApiPromptsByIdResponse200ResponseFormatType0JsonSchema,
)
from .get_api_prompts_by_id_response_200_response_format_type_0_json_schema_schema import (
    GetApiPromptsByIdResponse200ResponseFormatType0JsonSchemaSchema,
)
from .get_api_prompts_by_id_response_200_response_format_type_0_type import (
    GetApiPromptsByIdResponse200ResponseFormatType0Type,
)
from .get_api_prompts_by_id_response_400 import GetApiPromptsByIdResponse400
from .get_api_prompts_by_id_response_400_error import GetApiPromptsByIdResponse400Error
from .get_api_prompts_by_id_response_401 import GetApiPromptsByIdResponse401
from .get_api_prompts_by_id_response_401_error import GetApiPromptsByIdResponse401Error
from .get_api_prompts_by_id_response_404 import GetApiPromptsByIdResponse404
from .get_api_prompts_by_id_response_500 import GetApiPromptsByIdResponse500
from .get_api_prompts_by_id_versions_response_200 import GetApiPromptsByIdVersionsResponse200
from .get_api_prompts_by_id_versions_response_200_config_data import GetApiPromptsByIdVersionsResponse200ConfigData
from .get_api_prompts_by_id_versions_response_200_config_data_demonstrations import (
    GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrations,
)
from .get_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item import (
    GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem,
)
from .get_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item_type import (
    GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItemType,
)
from .get_api_prompts_by_id_versions_response_200_config_data_demonstrations_rows_item import (
    GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem,
)
from .get_api_prompts_by_id_versions_response_200_config_data_inputs_item import (
    GetApiPromptsByIdVersionsResponse200ConfigDataInputsItem,
)
from .get_api_prompts_by_id_versions_response_200_config_data_inputs_item_type import (
    GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType,
)
from .get_api_prompts_by_id_versions_response_200_config_data_messages_item import (
    GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItem,
)
from .get_api_prompts_by_id_versions_response_200_config_data_messages_item_role import (
    GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole,
)
from .get_api_prompts_by_id_versions_response_200_config_data_outputs_item import (
    GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItem,
)
from .get_api_prompts_by_id_versions_response_200_config_data_outputs_item_json_schema import (
    GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema,
)
from .get_api_prompts_by_id_versions_response_200_config_data_outputs_item_type import (
    GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItemType,
)
from .get_api_prompts_by_id_versions_response_400 import GetApiPromptsByIdVersionsResponse400
from .get_api_prompts_by_id_versions_response_400_error import GetApiPromptsByIdVersionsResponse400Error
from .get_api_prompts_by_id_versions_response_401 import GetApiPromptsByIdVersionsResponse401
from .get_api_prompts_by_id_versions_response_401_error import GetApiPromptsByIdVersionsResponse401Error
from .get_api_prompts_by_id_versions_response_404 import GetApiPromptsByIdVersionsResponse404
from .get_api_prompts_by_id_versions_response_500 import GetApiPromptsByIdVersionsResponse500
from .get_api_prompts_response_200_item import GetApiPromptsResponse200Item
from .get_api_prompts_response_200_item_messages_item import GetApiPromptsResponse200ItemMessagesItem
from .get_api_prompts_response_200_item_messages_item_role import GetApiPromptsResponse200ItemMessagesItemRole
from .get_api_prompts_response_200_item_response_format_type_0 import GetApiPromptsResponse200ItemResponseFormatType0
from .get_api_prompts_response_200_item_response_format_type_0_json_schema import (
    GetApiPromptsResponse200ItemResponseFormatType0JsonSchema,
)
from .get_api_prompts_response_200_item_response_format_type_0_json_schema_schema import (
    GetApiPromptsResponse200ItemResponseFormatType0JsonSchemaSchema,
)
from .get_api_prompts_response_200_item_response_format_type_0_type import (
    GetApiPromptsResponse200ItemResponseFormatType0Type,
)
from .get_api_prompts_response_400 import GetApiPromptsResponse400
from .get_api_prompts_response_400_error import GetApiPromptsResponse400Error
from .get_api_prompts_response_401 import GetApiPromptsResponse401
from .get_api_prompts_response_401_error import GetApiPromptsResponse401Error
from .get_api_prompts_response_500 import GetApiPromptsResponse500
from .get_api_trace_id_response_200 import GetApiTraceIdResponse200
from .get_api_trace_id_response_200_error_type_0 import GetApiTraceIdResponse200ErrorType0
from .get_api_trace_id_response_200_evaluations_item import GetApiTraceIdResponse200EvaluationsItem
from .get_api_trace_id_response_200_evaluations_item_error import GetApiTraceIdResponse200EvaluationsItemError
from .get_api_trace_id_response_200_evaluations_item_timestamps import GetApiTraceIdResponse200EvaluationsItemTimestamps
from .get_api_trace_id_response_200_input import GetApiTraceIdResponse200Input
from .get_api_trace_id_response_200_metadata import GetApiTraceIdResponse200Metadata
from .get_api_trace_id_response_200_metrics import GetApiTraceIdResponse200Metrics
from .get_api_trace_id_response_200_output import GetApiTraceIdResponse200Output
from .get_api_trace_id_response_200_spans_item import GetApiTraceIdResponse200SpansItem
from .get_api_trace_id_response_200_spans_item_error_type_0 import GetApiTraceIdResponse200SpansItemErrorType0
from .get_api_trace_id_response_200_spans_item_input import GetApiTraceIdResponse200SpansItemInput
from .get_api_trace_id_response_200_spans_item_input_value_item import GetApiTraceIdResponse200SpansItemInputValueItem
from .get_api_trace_id_response_200_spans_item_metrics import GetApiTraceIdResponse200SpansItemMetrics
from .get_api_trace_id_response_200_spans_item_output import GetApiTraceIdResponse200SpansItemOutput
from .get_api_trace_id_response_200_spans_item_output_value_item import GetApiTraceIdResponse200SpansItemOutputValueItem
from .get_api_trace_id_response_200_spans_item_params import GetApiTraceIdResponse200SpansItemParams
from .get_api_trace_id_response_200_spans_item_timestamps import GetApiTraceIdResponse200SpansItemTimestamps
from .get_api_trace_id_response_200_timestamps import GetApiTraceIdResponse200Timestamps
from .input_ import Input
from .metadata import Metadata
from .metrics import Metrics
from .output import Output
from .pagination import Pagination
from .patch_api_annotations_id_body import PatchApiAnnotationsIdBody
from .patch_api_annotations_id_response_200 import PatchApiAnnotationsIdResponse200
from .post_api_annotations_trace_id_body import PostApiAnnotationsTraceIdBody
from .post_api_prompts_body import PostApiPromptsBody
from .post_api_prompts_by_id_versions_body import PostApiPromptsByIdVersionsBody
from .post_api_prompts_by_id_versions_body_config_data import PostApiPromptsByIdVersionsBodyConfigData
from .post_api_prompts_by_id_versions_body_config_data_demonstrations import (
    PostApiPromptsByIdVersionsBodyConfigDataDemonstrations,
)
from .post_api_prompts_by_id_versions_body_config_data_demonstrations_columns_item import (
    PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem,
)
from .post_api_prompts_by_id_versions_body_config_data_demonstrations_columns_item_type import (
    PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItemType,
)
from .post_api_prompts_by_id_versions_body_config_data_demonstrations_rows_item import (
    PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem,
)
from .post_api_prompts_by_id_versions_body_config_data_inputs_item import (
    PostApiPromptsByIdVersionsBodyConfigDataInputsItem,
)
from .post_api_prompts_by_id_versions_body_config_data_inputs_item_type import (
    PostApiPromptsByIdVersionsBodyConfigDataInputsItemType,
)
from .post_api_prompts_by_id_versions_body_config_data_messages_item import (
    PostApiPromptsByIdVersionsBodyConfigDataMessagesItem,
)
from .post_api_prompts_by_id_versions_body_config_data_messages_item_role import (
    PostApiPromptsByIdVersionsBodyConfigDataMessagesItemRole,
)
from .post_api_prompts_by_id_versions_body_config_data_outputs_item import (
    PostApiPromptsByIdVersionsBodyConfigDataOutputsItem,
)
from .post_api_prompts_by_id_versions_body_config_data_outputs_item_json_schema import (
    PostApiPromptsByIdVersionsBodyConfigDataOutputsItemJsonSchema,
)
from .post_api_prompts_by_id_versions_body_config_data_outputs_item_type import (
    PostApiPromptsByIdVersionsBodyConfigDataOutputsItemType,
)
from .post_api_prompts_by_id_versions_response_200 import PostApiPromptsByIdVersionsResponse200
from .post_api_prompts_by_id_versions_response_200_config_data import PostApiPromptsByIdVersionsResponse200ConfigData
from .post_api_prompts_by_id_versions_response_200_config_data_demonstrations import (
    PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrations,
)
from .post_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item import (
    PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem,
)
from .post_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item_type import (
    PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItemType,
)
from .post_api_prompts_by_id_versions_response_200_config_data_demonstrations_rows_item import (
    PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem,
)
from .post_api_prompts_by_id_versions_response_200_config_data_inputs_item import (
    PostApiPromptsByIdVersionsResponse200ConfigDataInputsItem,
)
from .post_api_prompts_by_id_versions_response_200_config_data_inputs_item_type import (
    PostApiPromptsByIdVersionsResponse200ConfigDataInputsItemType,
)
from .post_api_prompts_by_id_versions_response_200_config_data_messages_item import (
    PostApiPromptsByIdVersionsResponse200ConfigDataMessagesItem,
)
from .post_api_prompts_by_id_versions_response_200_config_data_messages_item_role import (
    PostApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole,
)
from .post_api_prompts_by_id_versions_response_200_config_data_outputs_item import (
    PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItem,
)
from .post_api_prompts_by_id_versions_response_200_config_data_outputs_item_json_schema import (
    PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema,
)
from .post_api_prompts_by_id_versions_response_200_config_data_outputs_item_type import (
    PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemType,
)
from .post_api_prompts_by_id_versions_response_400 import PostApiPromptsByIdVersionsResponse400
from .post_api_prompts_by_id_versions_response_400_error import PostApiPromptsByIdVersionsResponse400Error
from .post_api_prompts_by_id_versions_response_401 import PostApiPromptsByIdVersionsResponse401
from .post_api_prompts_by_id_versions_response_401_error import PostApiPromptsByIdVersionsResponse401Error
from .post_api_prompts_by_id_versions_response_404 import PostApiPromptsByIdVersionsResponse404
from .post_api_prompts_by_id_versions_response_500 import PostApiPromptsByIdVersionsResponse500
from .post_api_prompts_response_200 import PostApiPromptsResponse200
from .post_api_prompts_response_200_messages_item import PostApiPromptsResponse200MessagesItem
from .post_api_prompts_response_200_messages_item_role import PostApiPromptsResponse200MessagesItemRole
from .post_api_prompts_response_200_response_format_type_0 import PostApiPromptsResponse200ResponseFormatType0
from .post_api_prompts_response_200_response_format_type_0_json_schema import (
    PostApiPromptsResponse200ResponseFormatType0JsonSchema,
)
from .post_api_prompts_response_200_response_format_type_0_json_schema_schema import (
    PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema,
)
from .post_api_prompts_response_200_response_format_type_0_type import PostApiPromptsResponse200ResponseFormatType0Type
from .post_api_prompts_response_400 import PostApiPromptsResponse400
from .post_api_prompts_response_400_error import PostApiPromptsResponse400Error
from .post_api_prompts_response_401 import PostApiPromptsResponse401
from .post_api_prompts_response_401_error import PostApiPromptsResponse401Error
from .post_api_prompts_response_500 import PostApiPromptsResponse500
from .post_api_trace_id_share_response_200 import PostApiTraceIdShareResponse200
from .post_api_trace_id_unshare_response_200 import PostApiTraceIdUnshareResponse200
from .put_api_prompts_by_id_body import PutApiPromptsByIdBody
from .put_api_prompts_by_id_response_200 import PutApiPromptsByIdResponse200
from .put_api_prompts_by_id_response_400 import PutApiPromptsByIdResponse400
from .put_api_prompts_by_id_response_400_error import PutApiPromptsByIdResponse400Error
from .put_api_prompts_by_id_response_401 import PutApiPromptsByIdResponse401
from .put_api_prompts_by_id_response_401_error import PutApiPromptsByIdResponse401Error
from .put_api_prompts_by_id_response_404 import PutApiPromptsByIdResponse404
from .put_api_prompts_by_id_response_500 import PutApiPromptsByIdResponse500
from .search_request import SearchRequest
from .search_request_filters import SearchRequestFilters
from .search_response import SearchResponse
from .timestamps import Timestamps
from .trace import Trace

__all__ = (
    "Annotation",
    "DatasetPostEntries",
    "DatasetPostEntriesEntriesItem",
    "DeleteApiAnnotationsIdResponse200",
    "DeleteApiPromptsByIdResponse200",
    "DeleteApiPromptsByIdResponse400",
    "DeleteApiPromptsByIdResponse400Error",
    "DeleteApiPromptsByIdResponse401",
    "DeleteApiPromptsByIdResponse401Error",
    "DeleteApiPromptsByIdResponse404",
    "DeleteApiPromptsByIdResponse500",
    "Error",
    "Evaluation",
    "EvaluationTimestamps",
    "GetApiDatasetBySlugOrIdResponse200",
    "GetApiDatasetBySlugOrIdResponse200DataItem",
    "GetApiDatasetBySlugOrIdResponse200DataItemEntry",
    "GetApiDatasetBySlugOrIdResponse400",
    "GetApiDatasetBySlugOrIdResponse401",
    "GetApiDatasetBySlugOrIdResponse404",
    "GetApiDatasetBySlugOrIdResponse422",
    "GetApiDatasetBySlugOrIdResponse500",
    "GetApiPromptsByIdResponse200",
    "GetApiPromptsByIdResponse200MessagesItem",
    "GetApiPromptsByIdResponse200MessagesItemRole",
    "GetApiPromptsByIdResponse200ResponseFormatType0",
    "GetApiPromptsByIdResponse200ResponseFormatType0JsonSchema",
    "GetApiPromptsByIdResponse200ResponseFormatType0JsonSchemaSchema",
    "GetApiPromptsByIdResponse200ResponseFormatType0Type",
    "GetApiPromptsByIdResponse400",
    "GetApiPromptsByIdResponse400Error",
    "GetApiPromptsByIdResponse401",
    "GetApiPromptsByIdResponse401Error",
    "GetApiPromptsByIdResponse404",
    "GetApiPromptsByIdResponse500",
    "GetApiPromptsByIdVersionsResponse200",
    "GetApiPromptsByIdVersionsResponse200ConfigData",
    "GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrations",
    "GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem",
    "GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItemType",
    "GetApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem",
    "GetApiPromptsByIdVersionsResponse200ConfigDataInputsItem",
    "GetApiPromptsByIdVersionsResponse200ConfigDataInputsItemType",
    "GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItem",
    "GetApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole",
    "GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItem",
    "GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema",
    "GetApiPromptsByIdVersionsResponse200ConfigDataOutputsItemType",
    "GetApiPromptsByIdVersionsResponse400",
    "GetApiPromptsByIdVersionsResponse400Error",
    "GetApiPromptsByIdVersionsResponse401",
    "GetApiPromptsByIdVersionsResponse401Error",
    "GetApiPromptsByIdVersionsResponse404",
    "GetApiPromptsByIdVersionsResponse500",
    "GetApiPromptsResponse200Item",
    "GetApiPromptsResponse200ItemMessagesItem",
    "GetApiPromptsResponse200ItemMessagesItemRole",
    "GetApiPromptsResponse200ItemResponseFormatType0",
    "GetApiPromptsResponse200ItemResponseFormatType0JsonSchema",
    "GetApiPromptsResponse200ItemResponseFormatType0JsonSchemaSchema",
    "GetApiPromptsResponse200ItemResponseFormatType0Type",
    "GetApiPromptsResponse400",
    "GetApiPromptsResponse400Error",
    "GetApiPromptsResponse401",
    "GetApiPromptsResponse401Error",
    "GetApiPromptsResponse500",
    "GetApiTraceIdResponse200",
    "GetApiTraceIdResponse200ErrorType0",
    "GetApiTraceIdResponse200EvaluationsItem",
    "GetApiTraceIdResponse200EvaluationsItemError",
    "GetApiTraceIdResponse200EvaluationsItemTimestamps",
    "GetApiTraceIdResponse200Input",
    "GetApiTraceIdResponse200Metadata",
    "GetApiTraceIdResponse200Metrics",
    "GetApiTraceIdResponse200Output",
    "GetApiTraceIdResponse200SpansItem",
    "GetApiTraceIdResponse200SpansItemErrorType0",
    "GetApiTraceIdResponse200SpansItemInput",
    "GetApiTraceIdResponse200SpansItemInputValueItem",
    "GetApiTraceIdResponse200SpansItemMetrics",
    "GetApiTraceIdResponse200SpansItemOutput",
    "GetApiTraceIdResponse200SpansItemOutputValueItem",
    "GetApiTraceIdResponse200SpansItemParams",
    "GetApiTraceIdResponse200SpansItemTimestamps",
    "GetApiTraceIdResponse200Timestamps",
    "Input",
    "Metadata",
    "Metrics",
    "Output",
    "Pagination",
    "PatchApiAnnotationsIdBody",
    "PatchApiAnnotationsIdResponse200",
    "PostApiAnnotationsTraceIdBody",
    "PostApiPromptsBody",
    "PostApiPromptsByIdVersionsBody",
    "PostApiPromptsByIdVersionsBodyConfigData",
    "PostApiPromptsByIdVersionsBodyConfigDataDemonstrations",
    "PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem",
    "PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItemType",
    "PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem",
    "PostApiPromptsByIdVersionsBodyConfigDataInputsItem",
    "PostApiPromptsByIdVersionsBodyConfigDataInputsItemType",
    "PostApiPromptsByIdVersionsBodyConfigDataMessagesItem",
    "PostApiPromptsByIdVersionsBodyConfigDataMessagesItemRole",
    "PostApiPromptsByIdVersionsBodyConfigDataOutputsItem",
    "PostApiPromptsByIdVersionsBodyConfigDataOutputsItemJsonSchema",
    "PostApiPromptsByIdVersionsBodyConfigDataOutputsItemType",
    "PostApiPromptsByIdVersionsResponse200",
    "PostApiPromptsByIdVersionsResponse200ConfigData",
    "PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrations",
    "PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem",
    "PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItemType",
    "PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem",
    "PostApiPromptsByIdVersionsResponse200ConfigDataInputsItem",
    "PostApiPromptsByIdVersionsResponse200ConfigDataInputsItemType",
    "PostApiPromptsByIdVersionsResponse200ConfigDataMessagesItem",
    "PostApiPromptsByIdVersionsResponse200ConfigDataMessagesItemRole",
    "PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItem",
    "PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemJsonSchema",
    "PostApiPromptsByIdVersionsResponse200ConfigDataOutputsItemType",
    "PostApiPromptsByIdVersionsResponse400",
    "PostApiPromptsByIdVersionsResponse400Error",
    "PostApiPromptsByIdVersionsResponse401",
    "PostApiPromptsByIdVersionsResponse401Error",
    "PostApiPromptsByIdVersionsResponse404",
    "PostApiPromptsByIdVersionsResponse500",
    "PostApiPromptsResponse200",
    "PostApiPromptsResponse200MessagesItem",
    "PostApiPromptsResponse200MessagesItemRole",
    "PostApiPromptsResponse200ResponseFormatType0",
    "PostApiPromptsResponse200ResponseFormatType0JsonSchema",
    "PostApiPromptsResponse200ResponseFormatType0JsonSchemaSchema",
    "PostApiPromptsResponse200ResponseFormatType0Type",
    "PostApiPromptsResponse400",
    "PostApiPromptsResponse400Error",
    "PostApiPromptsResponse401",
    "PostApiPromptsResponse401Error",
    "PostApiPromptsResponse500",
    "PostApiTraceIdShareResponse200",
    "PostApiTraceIdUnshareResponse200",
    "PutApiPromptsByIdBody",
    "PutApiPromptsByIdResponse200",
    "PutApiPromptsByIdResponse400",
    "PutApiPromptsByIdResponse400Error",
    "PutApiPromptsByIdResponse401",
    "PutApiPromptsByIdResponse401Error",
    "PutApiPromptsByIdResponse404",
    "PutApiPromptsByIdResponse500",
    "SearchRequest",
    "SearchRequestFilters",
    "SearchResponse",
    "Timestamps",
    "Trace",
)
