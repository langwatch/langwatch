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
	"unicode/utf8"
)

type ngram struct {
	value string
}

func newNgram(value string) ngram {
	charCount := utf8.RuneCountInString(value)
	if charCount > maxNgramLength {
		panic(fmt.Sprintf("length %v of ngram '%v' is greater than %v", charCount, value, maxNgramLength))
	}
	return ngram{value: value}
}

func getNgramNameByLength(ngramLength int) string {
	switch ngramLength {
	case 1:
		return "unigram"
	case 2:
		return "bigram"
	case 3:
		return "trigram"
	case 4:
		return "quadrigram"
	case 5:
		return "fivegram"
	default:
		panic(fmt.Sprintf("ngram length %v is not in range 1..5", ngramLength))
	}
}

func (n ngram) rangeOfLowerOrderNgrams() []ngram {
	var ngrams []ngram
	chars := []rune(n.value)

	for i := len(chars); i > 0; i-- {
		ngrams = append(ngrams, newNgram(string(chars[:i])))
	}

	return ngrams
}

func (n ngram) String() string {
	return n.value
}
