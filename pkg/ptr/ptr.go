package ptr

// P returns a pointer to v.
func P[T any](v T) *T {
	return &v
}

// ValueOrNil returns a pointer to v if non-zero, otherwise nil.
func ValueOrNil[T comparable](v T) *T {
	var zero T
	if v == zero {
		return nil
	}
	return &v
}

// ValueOrZero dereferences a pointer, returning the zero value if nil.
func ValueOrZero[T any](v *T) T {
	if v == nil {
		var zero T
		return zero
	}
	return *v
}

// ShallowCopy returns a pointer to a shallow copy of the pointed-to value.
func ShallowCopy[T any](v *T) *T {
	if v == nil {
		return nil
	}
	cpy := new(T)
	*cpy = *v
	return cpy
}
