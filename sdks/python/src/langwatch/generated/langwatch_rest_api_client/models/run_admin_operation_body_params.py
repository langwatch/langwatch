from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.run_admin_operation_body_params_data import RunAdminOperationBodyParamsData
    from ..models.run_admin_operation_body_params_filter import RunAdminOperationBodyParamsFilter
    from ..models.run_admin_operation_body_params_pagination import RunAdminOperationBodyParamsPagination
    from ..models.run_admin_operation_body_params_previous_data import RunAdminOperationBodyParamsPreviousData
    from ..models.run_admin_operation_body_params_sort import RunAdminOperationBodyParamsSort


T = TypeVar("T", bound="RunAdminOperationBodyParams")


@_attrs_define
class RunAdminOperationBodyParams:
    """
    Attributes:
        pagination (RunAdminOperationBodyParamsPagination | Unset):
        sort (RunAdminOperationBodyParamsSort | Unset):
        filter_ (RunAdminOperationBodyParamsFilter | Unset):
        id (float | str | Unset):
        data (RunAdminOperationBodyParamsData | Unset):
        previous_data (RunAdminOperationBodyParamsPreviousData | Unset):
    """

    pagination: RunAdminOperationBodyParamsPagination | Unset = UNSET
    sort: RunAdminOperationBodyParamsSort | Unset = UNSET
    filter_: RunAdminOperationBodyParamsFilter | Unset = UNSET
    id: float | str | Unset = UNSET
    data: RunAdminOperationBodyParamsData | Unset = UNSET
    previous_data: RunAdminOperationBodyParamsPreviousData | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        pagination: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pagination, Unset):
            pagination = self.pagination.to_dict()

        sort: dict[str, Any] | Unset = UNSET
        if not isinstance(self.sort, Unset):
            sort = self.sort.to_dict()

        filter_: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filter_, Unset):
            filter_ = self.filter_.to_dict()

        id: float | str | Unset
        if isinstance(self.id, Unset):
            id = UNSET
        else:
            id = self.id

        data: dict[str, Any] | Unset = UNSET
        if not isinstance(self.data, Unset):
            data = self.data.to_dict()

        previous_data: dict[str, Any] | Unset = UNSET
        if not isinstance(self.previous_data, Unset):
            previous_data = self.previous_data.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if pagination is not UNSET:
            field_dict["pagination"] = pagination
        if sort is not UNSET:
            field_dict["sort"] = sort
        if filter_ is not UNSET:
            field_dict["filter"] = filter_
        if id is not UNSET:
            field_dict["id"] = id
        if data is not UNSET:
            field_dict["data"] = data
        if previous_data is not UNSET:
            field_dict["previousData"] = previous_data

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.run_admin_operation_body_params_data import RunAdminOperationBodyParamsData
        from ..models.run_admin_operation_body_params_filter import RunAdminOperationBodyParamsFilter
        from ..models.run_admin_operation_body_params_pagination import RunAdminOperationBodyParamsPagination
        from ..models.run_admin_operation_body_params_previous_data import RunAdminOperationBodyParamsPreviousData
        from ..models.run_admin_operation_body_params_sort import RunAdminOperationBodyParamsSort

        d = dict(src_dict)
        _pagination = d.pop("pagination", UNSET)
        pagination: RunAdminOperationBodyParamsPagination | Unset
        if isinstance(_pagination, Unset):
            pagination = UNSET
        else:
            pagination = RunAdminOperationBodyParamsPagination.from_dict(_pagination)

        _sort = d.pop("sort", UNSET)
        sort: RunAdminOperationBodyParamsSort | Unset
        if isinstance(_sort, Unset):
            sort = UNSET
        else:
            sort = RunAdminOperationBodyParamsSort.from_dict(_sort)

        _filter_ = d.pop("filter", UNSET)
        filter_: RunAdminOperationBodyParamsFilter | Unset
        if isinstance(_filter_, Unset):
            filter_ = UNSET
        else:
            filter_ = RunAdminOperationBodyParamsFilter.from_dict(_filter_)

        def _parse_id(data: object) -> float | str | Unset:
            if isinstance(data, Unset):
                return data
            return cast(float | str | Unset, data)

        id = _parse_id(d.pop("id", UNSET))

        _data = d.pop("data", UNSET)
        data: RunAdminOperationBodyParamsData | Unset
        if isinstance(_data, Unset):
            data = UNSET
        else:
            data = RunAdminOperationBodyParamsData.from_dict(_data)

        _previous_data = d.pop("previousData", UNSET)
        previous_data: RunAdminOperationBodyParamsPreviousData | Unset
        if isinstance(_previous_data, Unset):
            previous_data = UNSET
        else:
            previous_data = RunAdminOperationBodyParamsPreviousData.from_dict(_previous_data)

        run_admin_operation_body_params = cls(
            pagination=pagination,
            sort=sort,
            filter_=filter_,
            id=id,
            data=data,
            previous_data=previous_data,
        )

        run_admin_operation_body_params.additional_properties = d
        return run_admin_operation_body_params

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
