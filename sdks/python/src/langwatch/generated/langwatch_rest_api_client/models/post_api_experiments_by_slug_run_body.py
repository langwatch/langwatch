from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_experiments_by_slug_run_body_data_item import PostApiExperimentsBySlugRunBodyDataItem
    from ..models.post_api_experiments_by_slug_run_body_parameters import PostApiExperimentsBySlugRunBodyParameters


T = TypeVar("T", bound="PostApiExperimentsBySlugRunBody")


@_attrs_define
class PostApiExperimentsBySlugRunBody:
    """
    Attributes:
        data (list[PostApiExperimentsBySlugRunBodyDataItem] | Unset): Rows to evaluate inline, instead of the
            experiment's saved dataset. Mutually exclusive with dataset_id.
        dataset_id (str | Unset): A saved dataset to evaluate, instead of the one the experiment is configured with.
            Mutually exclusive with data.
        parameters (PostApiExperimentsBySlugRunBodyParameters | Unset): Constant inputs applied to every row, overriding
            fields of the same name
        row_indices (list[int] | Unset): Run only these rows of the dataset, by zero-based index
    """

    data: list[PostApiExperimentsBySlugRunBodyDataItem] | Unset = UNSET
    dataset_id: str | Unset = UNSET
    parameters: PostApiExperimentsBySlugRunBodyParameters | Unset = UNSET
    row_indices: list[int] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.data, Unset):
            data = []
            for data_item_data in self.data:
                data_item = data_item_data.to_dict()
                data.append(data_item)

        dataset_id = self.dataset_id

        parameters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.parameters, Unset):
            parameters = self.parameters.to_dict()

        row_indices: list[int] | Unset = UNSET
        if not isinstance(self.row_indices, Unset):
            row_indices = self.row_indices

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if data is not UNSET:
            field_dict["data"] = data
        if dataset_id is not UNSET:
            field_dict["dataset_id"] = dataset_id
        if parameters is not UNSET:
            field_dict["parameters"] = parameters
        if row_indices is not UNSET:
            field_dict["row_indices"] = row_indices

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_experiments_by_slug_run_body_data_item import PostApiExperimentsBySlugRunBodyDataItem
        from ..models.post_api_experiments_by_slug_run_body_parameters import PostApiExperimentsBySlugRunBodyParameters

        d = dict(src_dict)
        _data = d.pop("data", UNSET)
        data: list[PostApiExperimentsBySlugRunBodyDataItem] | Unset = UNSET
        if _data is not UNSET:
            data = []
            for data_item_data in _data:
                data_item = PostApiExperimentsBySlugRunBodyDataItem.from_dict(data_item_data)

                data.append(data_item)

        dataset_id = d.pop("dataset_id", UNSET)

        _parameters = d.pop("parameters", UNSET)
        parameters: PostApiExperimentsBySlugRunBodyParameters | Unset
        if isinstance(_parameters, Unset):
            parameters = UNSET
        else:
            parameters = PostApiExperimentsBySlugRunBodyParameters.from_dict(_parameters)

        row_indices = cast(list[int], d.pop("row_indices", UNSET))

        post_api_experiments_by_slug_run_body = cls(
            data=data,
            dataset_id=dataset_id,
            parameters=parameters,
            row_indices=row_indices,
        )

        post_api_experiments_by_slug_run_body.additional_properties = d
        return post_api_experiments_by_slug_run_body

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
