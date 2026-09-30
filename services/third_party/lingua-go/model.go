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

import (
	"fmt"
	"regexp"
	"strings"
)

type trainingDataLanguageModel struct {
	language            Language
	absoluteFrequencies map[ngram]uint32
	relativeFrequencies map[ngram]float64
}

type testDataLanguageModel struct {
	ngrams [][]ngram
}

func newTrainingDataLanguageModel(
	text []string,
	language Language,
	ngramLength int,
	charClass string,
	lowerNgramAbsoluteFrequencies map[ngram]uint32,
) trainingDataLanguageModel {
	absoluteFrequencies := computeAbsoluteFrequencies(text, ngramLength, charClass)
	relativeFrequencies := computeRelativeFrequencies(ngramLength, absoluteFrequencies, lowerNgramAbsoluteFrequencies)

	return trainingDataLanguageModel{
		language:            language,
		absoluteFrequencies: absoluteFrequencies,
		relativeFrequencies: relativeFrequencies,
	}
}

func newTestDataLanguageModel(words []string, ngramLength int) testDataLanguageModel {
	if ngramLength > maxNgramLength {
		panic(fmt.Sprintf("ngram length %v is greater than %v", ngramLength, maxNgramLength))
	}
	ngrams := make(map[ngram]struct{})

	for _, word := range words {
		chars := []rune(word)
		charsCount := len(chars)

		if charsCount >= ngramLength {
			for i := 0; i <= charsCount-ngramLength; i++ {
				slice := string(chars[i : i+ngramLength])
				ngrams[newNgram(slice)] = struct{}{}
			}
		}
	}

	lowerOrderNgrams := make([][]ngram, len(ngrams))
	i := 0
	for n := range ngrams {
		lowerOrderNgrams[i] = n.rangeOfLowerOrderNgrams()
		i++
	}

	return testDataLanguageModel{ngrams: lowerOrderNgrams}
}

func computeAbsoluteFrequencies(
	text []string,
	ngramLength int,
	charClass string,
) map[ngram]uint32 {
	absoluteFrequencies := make(map[ngram]uint32)
	regex, err := regexp.Compile(fmt.Sprintf("^[%v]+$", charClass))
	if err != nil {
		panic(fmt.Sprintf("The character class '%v' cannot be compiled to a valid regular expression", charClass))
	}
	for _, line := range text {
		chars := []rune(strings.ToLower(line))
		for i := 0; i <= len(chars)-ngramLength; i++ {
			slice := string(chars[i : i+ngramLength])
			if regex.MatchString(slice) {
				absoluteFrequencies[newNgram(slice)]++
			}
		}
	}
	return absoluteFrequencies
}

func computeRelativeFrequencies(
	ngramLength int,
	absoluteFrequencies map[ngram]uint32,
	lowerNgramAbsoluteFrequencies map[ngram]uint32,
) map[ngram]float64 {
	ngramProbabilities := make(map[ngram]float64, len(absoluteFrequencies))
	var totalNgramFrequency uint32
	for _, frequency := range absoluteFrequencies {
		totalNgramFrequency += frequency
	}
	for ngram, frequency := range absoluteFrequencies {
		var denominator uint32
		if ngramLength == 1 || len(lowerNgramAbsoluteFrequencies) == 0 {
			denominator = totalNgramFrequency
		} else {
			chars := []rune(ngram.value)
			slice := string(chars[0 : ngramLength-1])
			denominator = lowerNgramAbsoluteFrequencies[newNgram(slice)]
		}
		ngramProbabilities[ngram] = float64(frequency) / float64(denominator)
	}
	return ngramProbabilities
}
