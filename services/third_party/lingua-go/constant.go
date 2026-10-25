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

import "regexp"

const maxNgramLength = 5

var japaneseCharacterSet = regexp.MustCompile(`^[\p{Hiragana}\p{Katakana}\p{Han}]+$`)
var multipleWhitespace = regexp.MustCompile(`\s+`)
var numbers = regexp.MustCompile(`\p{N}`)
var punctuation = regexp.MustCompile(`\p{P}`)
// letters is lingua-rs 1.7.2's tokenizer (the engine under Python lingua 2.1.1):
// Go's \p{L} drops Indic combining marks and upstream split Hangul per syllable.
var letters = regexp.MustCompile(`\p{Bengali}+|\p{Devanagari}+|\p{Gujarati}+|\p{Gurmukhi}+|\p{Han}|\p{Hangul}+|\p{Hiragana}|\p{Katakana}|\p{Tamil}+|\p{Telugu}+|\p{Thai}+|\p{L}+`)
var tokensWithOptionalWhitespace = regexp.MustCompile(`\s*(?:\p{Han}|\p{Hangul}|\p{Hiragana}|\p{Katakana}|[\p{L}'-]+)[\p{N}\p{P}]*\s*`)
var tokensWithoutWhitespace = regexp.MustCompile(`\p{Han}|\p{Hangul}|\p{Hiragana}|\p{Katakana}|\p{L}+`)

var charsToLanguagesMapping = map[string][]Language{
	"Ãã":     {Portuguese, Vietnamese},
	"ĄąĘę":   {Lithuanian, Polish},
	"Żż":     {Polish, Romanian},
	"Îî":     {French, Romanian},
	"Ññ":     {Basque, Spanish},
	"ŇňŤť":   {Czech, Slovak},
	"Ăă":     {Romanian, Vietnamese},
	"İıĞğ":   {Azerbaijani, Turkish},
	"ЈјЉљЊњ": {Macedonian, Serbian},
	"ẸẹỌọ":   {Vietnamese, Yoruba},
	"ÐðÞþ":   {Icelandic, Turkish},
	"Ûû":     {French, Hungarian},
	"Ōō":     {Maori, Yoruba},

	"ĀāĒēĪī": {Latvian, Maori, Yoruba},
	"Şş":     {Azerbaijani, Romanian, Turkish},
	"Ďď":     {Czech, Romanian, Slovak},
	"Ćć":     {Bosnian, Croatian, Polish},
	"Đđ":     {Bosnian, Croatian, Vietnamese},
	"Іі":     {Belarusian, Kazakh, Ukrainian},
	"Ìì":     {Italian, Vietnamese, Yoruba},
	"Øø":     {Bokmal, Danish, Nynorsk},

	"Ūū":     {Latvian, Lithuanian, Maori, Yoruba},
	"Ëë":     {Afrikaans, Albanian, Dutch, French},
	"ÈèÙù":   {French, Italian, Vietnamese, Yoruba},
	"Êê":     {Afrikaans, French, Portuguese, Vietnamese},
	"Õõ":     {Estonian, Hungarian, Portuguese, Vietnamese},
	"Ôô":     {French, Portuguese, Slovak, Vietnamese},
	"ЁёЫыЭэ": {Belarusian, Kazakh, Mongolian, Russian},
	"ЩщЪъ":   {Bulgarian, Kazakh, Mongolian, Russian},
	"Òò":     {Catalan, Italian, Vietnamese, Yoruba},
	"Ææ":     {Bokmal, Danish, Icelandic, Nynorsk},
	"Åå":     {Bokmal, Danish, Nynorsk, Swedish},

	"Ýý": {Czech, Icelandic, Slovak, Turkish, Vietnamese},
	"Ää": {Estonian, Finnish, German, Slovak, Swedish},
	"Àà": {Catalan, French, Italian, Portuguese, Vietnamese},
	"Ââ": {French, Portuguese, Romanian, Turkish, Vietnamese},

	"Üü":     {Azerbaijani, Catalan, Estonian, German, Hungarian, Spanish, Turkish},
	"ČčŠšŽž": {Bosnian, Czech, Croatian, Latvian, Lithuanian, Slovak, Slovene},
	"Çç":     {Albanian, Azerbaijani, Basque, Catalan, French, Portuguese, Turkish},

	"Öö": {Azerbaijani, Estonian, Finnish, German, Hungarian, Icelandic, Swedish, Turkish},

	"Óó":     {Catalan, Hungarian, Icelandic, Irish, Polish, Portuguese, Slovak, Spanish, Vietnamese, Yoruba},
	"ÁáÍíÚú": {Catalan, Czech, Icelandic, Irish, Hungarian, Portuguese, Slovak, Spanish, Vietnamese, Yoruba},

	"Éé": {Catalan, Czech, French, Hungarian, Icelandic, Irish, Italian, Portuguese, Slovak, Spanish, Vietnamese, Yoruba},
}
