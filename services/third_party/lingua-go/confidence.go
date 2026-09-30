/*
 * Copyright © 2021-present Peter M. Stahl pemistahl@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either expressed or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package lingua

// ConfidenceValue is the interface describing a language's confidence value
// that is computed by LanguageDetector.ComputeLanguageConfidenceValues.
type ConfidenceValue interface {
	// Language returns the language being part of this ConfidenceValue.
	Language() Language

	// Value returns a language's confidence value which lies between 0.0 and 1.0.
	Value() float64
}

type confidenceValue struct {
	language Language
	value    float64
}

type confidenceValueSlice []ConfidenceValue

func newConfidenceValue(language Language, value float64) ConfidenceValue {
	return confidenceValue{language, value}
}

func (c confidenceValue) Language() Language {
	return c.language
}

func (c confidenceValue) Value() float64 {
	return c.value
}

func (c confidenceValueSlice) Len() int {
	return len(c)
}

func (c confidenceValueSlice) Less(i, j int) bool {
	first, second := c[i], c[j]
	if first.Value() == second.Value() {
		return first.Language() < second.Language()
	}
	return first.Value() > second.Value()
}

func (c confidenceValueSlice) Swap(i, j int) {
	c[i], c[j] = c[j], c[i]
}
