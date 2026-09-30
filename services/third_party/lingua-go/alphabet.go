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
)

type alphabet int

const (
	arabic alphabet = iota
	armenian
	bengali
	cyrillic
	devanagari
	georgian
	greek
	gujarati
	gurmukhi
	han
	hangul
	hebrew
	hiragana
	katakana
	latin
	tamil
	telugu
	thai
)

func (alphabet alphabet) matches(text string) bool {
	switch alphabet {
	case arabic:
		return arabicChars.MatchString(text)
	case armenian:
		return armenianChars.MatchString(text)
	case bengali:
		return bengaliChars.MatchString(text)
	case cyrillic:
		return cyrillicChars.MatchString(text)
	case devanagari:
		return devanagariChars.MatchString(text)
	case georgian:
		return georgianChars.MatchString(text)
	case greek:
		return greekChars.MatchString(text)
	case gujarati:
		return gujaratiChars.MatchString(text)
	case gurmukhi:
		return gurmukhiChars.MatchString(text)
	case han:
		return hanChars.MatchString(text)
	case hangul:
		return hangulChars.MatchString(text)
	case hebrew:
		return hebrewChars.MatchString(text)
	case hiragana:
		return hiraganaChars.MatchString(text)
	case katakana:
		return katakanaChars.MatchString(text)
	case latin:
		return latinChars.MatchString(text)
	case tamil:
		return tamilChars.MatchString(text)
	case telugu:
		return teluguChars.MatchString(text)
	case thai:
		return thaiChars.MatchString(text)
	default:
		return false
	}
}

func (alphabet alphabet) supportedLanguages() (languages []Language) {
	for _, language := range AllLanguages() {
		for _, script := range language.alphabets() {
			if script == alphabet {
				languages = append(languages, language)
			}
		}
	}
	return
}

func allAlphabetsSupportingSingleLanguage() map[alphabet]Language {
	alphabets := make(map[alphabet]Language)
	for _, alphabet := range allAlphabets() {
		supportedLanguages := alphabet.supportedLanguages()
		if len(supportedLanguages) == 1 {
			alphabets[alphabet] = supportedLanguages[0]
		}
	}
	return alphabets
}

func allAlphabets() []alphabet {
	alphabets := make([]alphabet, thai+1)
	for i := 0; i <= int(thai); i++ {
		alphabets[i] = alphabet(i)
	}
	return alphabets
}

var (
	arabicChars     = createRegexp("Arabic")
	armenianChars   = createRegexp("Armenian")
	bengaliChars    = createRegexp("Bengali")
	cyrillicChars   = createRegexp("Cyrillic")
	devanagariChars = createRegexp("Devanagari")
	georgianChars   = createRegexp("Georgian")
	greekChars      = createRegexp("Greek")
	gujaratiChars   = createRegexp("Gujarati")
	gurmukhiChars   = createRegexp("Gurmukhi")
	hanChars        = createRegexp("Han")
	hangulChars     = createRegexp("Hangul")
	hebrewChars     = createRegexp("Hebrew")
	hiraganaChars   = createRegexp("Hiragana")
	katakanaChars   = createRegexp("Katakana")
	latinChars      = createRegexp("Latin")
	tamilChars      = createRegexp("Tamil")
	teluguChars     = createRegexp("Telugu")
	thaiChars       = createRegexp("Thai")
)

func createRegexp(charClass string) *regexp.Regexp {
	return regexp.MustCompile(fmt.Sprintf("^\\p{%v}+$", charClass))
}
