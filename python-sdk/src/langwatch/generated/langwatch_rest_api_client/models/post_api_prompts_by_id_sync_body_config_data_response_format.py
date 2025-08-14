from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_api_prompts_by_id_sync_body_config_data_response_format_type import (
    PostApiPromptsByIdSyncBodyConfigDataResponseFormatType,
)

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_sync_body_config_data_response_format_json_schema_type_0 import (
        PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0,
    )


T = TypeVar("T", bound="PostApiPromptsByIdSyncBodyConfigDataResponseFormat")


@_attrs_define
class PostApiPromptsByIdSyncBodyConfigDataResponseFormat:
    """
    Attributes:
        type_ (PostApiPromptsByIdSyncBodyConfigDataResponseFormatType):
        json_schema (Union['PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0', None]):
    """

    type_: PostApiPromptsByIdSyncBodyConfigDataResponseFormatType
    json_schema: Union["PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0", None]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_api_prompts_by_id_sync_body_config_data_response_format_json_schema_type_0 import (
            PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0,
        )

        type_ = self.type_.value

        json_schema: Union[None, dict[str, Any]]
        if isinstance(self.json_schema, PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0):
            json_schema = self.json_schema.to_dict()
        else:
            json_schema = self.json_schema

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "type": type_,
                "json_schema": json_schema,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_sync_body_config_data_response_format_json_schema_type_0 import (
            PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0,
        )

        d = dict(src_dict)
        type_ = PostApiPromptsByIdSyncBodyConfigDataResponseFormatType(d.pop("type"))

        def _parse_json_schema(
            data: object,
        ) -> Union["PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0", None]:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                json_schema_type_0 = PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0.from_dict(data)

                return json_schema_type_0
            except:  # noqa: E722
                pass
            return cast(Union["PostApiPromptsByIdSyncBodyConfigDataResponseFormatJsonSchemaType0", None], data)

        json_schema = _parse_json_schema(d.pop("json_schema"))

        post_api_prompts_by_id_sync_body_config_data_response_format = cls(
            type_=type_,
            json_schema=json_schema,
        )

        post_api_prompts_by_id_sync_body_config_data_response_format.additional_properties = d
        return post_api_prompts_by_id_sync_body_config_data_response_format

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
