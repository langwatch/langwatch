from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_prompts_by_id_versions_body_config_data_demonstrations_columns_item import (
        PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem,
    )
    from ..models.post_api_prompts_by_id_versions_body_config_data_demonstrations_rows_item import (
        PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem,
    )


T = TypeVar("T", bound="PostApiPromptsByIdVersionsBodyConfigDataDemonstrations")


@_attrs_define
class PostApiPromptsByIdVersionsBodyConfigDataDemonstrations:
    """
    Attributes:
        columns (list['PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem']):
        rows (Union[Unset, list['PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem']]):
    """

    columns: list["PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem"]
    rows: Union[Unset, list["PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem"]] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        rows: Union[Unset, list[dict[str, Any]]] = UNSET
        if not isinstance(self.rows, Unset):
            rows = []
            for rows_item_data in self.rows:
                rows_item = rows_item_data.to_dict()
                rows.append(rows_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "columns": columns,
            }
        )
        if rows is not UNSET:
            field_dict["rows"] = rows

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_prompts_by_id_versions_body_config_data_demonstrations_columns_item import (
            PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem,
        )
        from ..models.post_api_prompts_by_id_versions_body_config_data_demonstrations_rows_item import (
            PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem,
        )

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsColumnsItem.from_dict(
                columns_item_data
            )

            columns.append(columns_item)

        rows = []
        _rows = d.pop("rows", UNSET)
        for rows_item_data in _rows or []:
            rows_item = PostApiPromptsByIdVersionsBodyConfigDataDemonstrationsRowsItem.from_dict(rows_item_data)

            rows.append(rows_item)

        post_api_prompts_by_id_versions_body_config_data_demonstrations = cls(
            columns=columns,
            rows=rows,
        )

        post_api_prompts_by_id_versions_body_config_data_demonstrations.additional_properties = d
        return post_api_prompts_by_id_versions_body_config_data_demonstrations

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
