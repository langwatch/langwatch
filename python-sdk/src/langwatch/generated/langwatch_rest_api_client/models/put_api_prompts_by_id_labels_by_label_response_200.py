from collections.abc import Mapping
from typing import Any, TypeVar, Union

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PutApiPromptsByIdLabelsByLabelResponse200")


@_attrs_define
class PutApiPromptsByIdLabelsByLabelResponse200:
    """
    Attributes:
        config_id (str):
        version_id (str):
        updated_at (str):
        tag (Union[Unset, str]):
    """

    config_id: str
    version_id: str
    updated_at: str
    tag: Union[Unset, str] = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        config_id = self.config_id

        version_id = self.version_id

        updated_at = self.updated_at

        tag = self.tag

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "configId": config_id,
                "versionId": version_id,
                "updatedAt": updated_at,
            }
        )
        if tag is not UNSET:
            field_dict["tag"] = tag

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        config_id = d.pop("configId")

        version_id = d.pop("versionId")

        updated_at = d.pop("updatedAt")

        tag = d.pop("tag", UNSET)

        put_api_prompts_by_id_labels_by_label_response_200 = cls(
            config_id=config_id,
            version_id=version_id,
            updated_at=updated_at,
            tag=tag,
        )

        put_api_prompts_by_id_labels_by_label_response_200.additional_properties = d
        return put_api_prompts_by_id_labels_by_label_response_200

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
