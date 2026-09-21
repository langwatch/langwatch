from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_api_experiments_body_state import PostApiExperimentsBodyState


T = TypeVar("T", bound="PostApiExperimentsBody")


@_attrs_define
class PostApiExperimentsBody:
    """
    Attributes:
        name (str | Unset): Name for the experiment. A draft name is picked when omitted.
        state (PostApiExperimentsBodyState | Unset): Setup to start from. Omit for a blank workbench with one inline
            dataset.
    """

    name: str | Unset = UNSET
    state: PostApiExperimentsBodyState | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        state: dict[str, Any] | Unset = UNSET
        if not isinstance(self.state, Unset):
            state = self.state.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if name is not UNSET:
            field_dict["name"] = name
        if state is not UNSET:
            field_dict["state"] = state

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_api_experiments_body_state import PostApiExperimentsBodyState

        d = dict(src_dict)
        name = d.pop("name", UNSET)

        _state = d.pop("state", UNSET)
        state: PostApiExperimentsBodyState | Unset
        if isinstance(_state, Unset):
            state = UNSET
        else:
            state = PostApiExperimentsBodyState.from_dict(_state)

        post_api_experiments_body = cls(
            name=name,
            state=state,
        )

        post_api_experiments_body.additional_properties = d
        return post_api_experiments_body

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
