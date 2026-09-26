from __future__ import annotations

from collections.abc import Mapping
from io import BytesIO
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from .. import types
from ..types import UNSET, File, Unset

T = TypeVar("T", bound="PostApiDatasetAttachmentsBody")


@_attrs_define
class PostApiDatasetAttachmentsBody:
    """
    Attributes:
        file (File): The file to store.
        dataset_id (str | Unset): The dataset that owns the file. Omit it while the dataset is still a draft.
    """

    file: File
    dataset_id: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        file = self.file.to_tuple()

        dataset_id = self.dataset_id

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "file": file,
            }
        )
        if dataset_id is not UNSET:
            field_dict["datasetId"] = dataset_id

        return field_dict

    def to_multipart(self) -> types.RequestFiles:
        files: types.RequestFiles = []

        files.append(("file", self.file.to_tuple()))

        if not isinstance(self.dataset_id, Unset):
            files.append(("datasetId", (None, str(self.dataset_id).encode(), "text/plain")))

        for prop_name, prop in self.additional_properties.items():
            files.append((prop_name, (None, str(prop).encode(), "text/plain")))

        return files

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        file = File(payload=BytesIO(d.pop("file")))

        dataset_id = d.pop("datasetId", UNSET)

        post_api_dataset_attachments_body = cls(
            file=file,
            dataset_id=dataset_id,
        )

        post_api_dataset_attachments_body.additional_properties = d
        return post_api_dataset_attachments_body

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
