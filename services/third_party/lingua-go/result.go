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

// DetectionResult is the interface describing a contiguous single-language
// text section within a possibly mixed-language text. It is computed by
// LanguageDetector.DetectMultipleLanguagesOf.
type DetectionResult interface {
	// StartIndex returns the start index of the identified single-language substring.
	StartIndex() int
	// EndIndex returns the end index of the identified single-language substring.
	EndIndex() int
	// Language returns the language being part of this DetectionResult.
	Language() Language
}

type detectionResult struct {
	startIndex int
	endIndex   int
	wordCount  int
	language   Language
}

func newDetectionResult(startIndex, endIndex, wordCount int, language Language) detectionResult {
	return detectionResult{startIndex, endIndex, wordCount, language}
}

func (slice detectionResult) StartIndex() int {
	return slice.startIndex
}

func (slice detectionResult) EndIndex() int {
	return slice.endIndex
}

func (slice detectionResult) Language() Language {
	return slice.language
}
