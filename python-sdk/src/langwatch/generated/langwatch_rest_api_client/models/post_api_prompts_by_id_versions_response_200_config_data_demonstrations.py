from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item import (
        PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem,
    )
    from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_inline import (
        PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline,
    )
    from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_rows_item import (
        PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem,
    )


T = TypeVar("T", bound="PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrations")


@_attrs_define
class PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrations:
    """
    Attributes:
        columns (list['PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem']):
        rows (list['PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem']):
        id (Union[Unset, str]):
        name (Union[Unset, str]):
        inline (Union[Unset, PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline]):
    """

    columns: list["PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem"]
    rows: list["PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem"]
    id: Union[Unset, str] = UNSET
    name: Union[Unset, str] = UNSET
    inline: Union[Unset, "PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline"] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data.to_dict()
            rows.append(rows_item)

        id = self.id

        name = self.name

        inline: Union[Unset, dict[str, Any]] = UNSET
        if not isinstance(self.inline, Unset):
            inline = self.inline.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "columns": columns,
                "rows": rows,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if name is not UNSET:
            field_dict["name"] = name
        if inline is not UNSET:
            field_dict["inline"] = inline

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_columns_item import (
            PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem,
        )
        from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_inline import (
            PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline,
        )
        from ..models.post_api_prompts_by_id_versions_response_200_config_data_demonstrations_rows_item import (
            PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem,
        )

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsColumnsItem.from_dict(
                columns_item_data
            )

            columns.append(columns_item)

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsRowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        id = d.pop("id", UNSET)

        name = d.pop("name", UNSET)

        _inline = d.pop("inline", UNSET)
        inline: Union[Unset, PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline]
        if isinstance(_inline, Unset):
            inline = UNSET
        else:
            inline = PostApiPromptsByIdVersionsResponse200ConfigDataDemonstrationsInline.from_dict(_inline)

        post_api_prompts_by_id_versions_response_200_config_data_demonstrations = cls(
            columns=columns,
            rows=rows,
            id=id,
            name=name,
            inline=inline,
        )

        post_api_prompts_by_id_versions_response_200_config_data_demonstrations.additional_properties = d
        return post_api_prompts_by_id_versions_response_200_config_data_demonstrations

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
