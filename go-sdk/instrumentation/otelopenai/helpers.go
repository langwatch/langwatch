package otelopenai

// jsonData is a type alias for a map of string keys to interface{} values.
type jsonData = map[string]interface{}

// getString safely extracts a string value from a map.
func getString(data jsonData, key string) (string, bool) {
	val, ok := data[key].(string)
	return val, ok
}

// getFloat64 safely extracts a float64 value from a map.
func getFloat64(data jsonData, key string) (float64, bool) {
	val, ok := data[key].(float64)
	return val, ok
}

// getInt safely extracts an int value from a map.
func getInt(data jsonData, key string) (int, bool) {
	val, ok := data[key].(float64) // JSON numbers are often float64
	if ok {
		return int(val), true
	}

	intVal, okInt := data[key].(int)
	return intVal, okInt
}
