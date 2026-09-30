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

// Language is the type used for enumerating the so far 75 languages which can
// be detected by Lingua.
//
type Language int

const (
	Afrikaans Language = iota
	Albanian
	Arabic
	Armenian
	Azerbaijani
	Basque
	Belarusian
	Bengali
	Bokmal
	Bosnian
	Bulgarian
	Catalan
	Chinese
	Croatian
	Czech
	Danish
	Dutch
	English
	Esperanto
	Estonian
	Finnish
	French
	Ganda
	Georgian
	German
	Greek
	Gujarati
	Hebrew
	Hindi
	Hungarian
	Icelandic
	Indonesian
	Irish
	Italian
	Japanese
	Kazakh
	Korean
	Latin
	Latvian
	Lithuanian
	Macedonian
	Malay
	Maori
	Marathi
	Mongolian
	Nynorsk
	Persian
	Polish
	Portuguese
	Punjabi
	Romanian
	Russian
	Serbian
	Shona
	Slovak
	Slovene
	Somali
	Sotho
	Spanish
	Swahili
	Swedish
	Tagalog
	Tamil
	Telugu
	Thai
	Tsonga
	Tswana
	Turkish
	Ukrainian
	Urdu
	Vietnamese
	Welsh
	Xhosa
	Yoruba
	Zulu
	Unknown
)

// AllLanguages returns a sorted slice of all currently supported languages.
func AllLanguages() []Language {
	languages := make([]Language, amountOfSupportedLanguages())
	for i := 0; i < amountOfSupportedLanguages(); i++ {
		languages[i] = Language(i)
	}
	return languages
}

// AllSpokenLanguages returns a sorted slice of all supported languages
// that are not extinct but still spoken.
func AllSpokenLanguages() (languages []Language) {
	for _, language := range AllLanguages() {
		if language != Latin {
			languages = append(languages, language)
		}
	}
	return
}

// AllLanguagesWithArabicScript returns a sorted slice of all built-in
// languages supporting the Arabic script.
func AllLanguagesWithArabicScript() []Language {
	return allLanguagesWithScript(arabic)
}

// AllLanguagesWithCyrillicScript returns a sorted slice of all built-in
// languages supporting the Cyrillic script.
func AllLanguagesWithCyrillicScript() []Language {
	return allLanguagesWithScript(cyrillic)
}

// AllLanguagesWithDevanagariScript returns a sorted slice of all built-in
// languages supporting the Devanagari script.
func AllLanguagesWithDevanagariScript() []Language {
	return allLanguagesWithScript(devanagari)
}

// AllLanguagesWithLatinScript returns a sorted slice of all built-in
// languages supporting the Latin script.
func AllLanguagesWithLatinScript() []Language {
	return allLanguagesWithScript(latin)
}

// GetLanguageFromIsoCode639_1 returns the language for the given
// ISO 639-1 code enum value.
func GetLanguageFromIsoCode639_1(isoCode IsoCode639_1) Language {
	for _, language := range AllLanguages() {
		if language.IsoCode639_1() == isoCode {
			return language
		}
	}
	return Unknown
}

// GetLanguageFromIsoCode639_3 returns the language for the given
// ISO 639-3 code enum value.
func GetLanguageFromIsoCode639_3(isoCode IsoCode639_3) Language {
	for _, language := range AllLanguages() {
		if language.IsoCode639_3() == isoCode {
			return language
		}
	}
	return Unknown
}

func allLanguagesWithScript(script alphabet) (languages []Language) {
	for _, language := range AllLanguages() {
		if language.alphabets()[0] == script {
			languages = append(languages, language)
		}
	}
	return
}

func amountOfSupportedLanguages() int {
	return int(Zulu + 1)
}

// IsoCode639_1 returns a language's ISO 639-1 code.
func (language Language) IsoCode639_1() IsoCode639_1 {
	switch language {
	case Afrikaans:
		return AF
	case Albanian:
		return SQ
	case Arabic:
		return AR
	case Armenian:
		return HY
	case Azerbaijani:
		return AZ
	case Basque:
		return EU
	case Belarusian:
		return BE
	case Bengali:
		return BN
	case Bokmal:
		return NB
	case Bosnian:
		return BS
	case Bulgarian:
		return BG
	case Catalan:
		return CA
	case Chinese:
		return ZH
	case Croatian:
		return HR
	case Czech:
		return CS
	case Danish:
		return DA
	case Dutch:
		return NL
	case English:
		return EN
	case Esperanto:
		return EO
	case Estonian:
		return ET
	case Finnish:
		return FI
	case French:
		return FR
	case Ganda:
		return LG
	case Georgian:
		return KA
	case German:
		return DE
	case Greek:
		return EL
	case Gujarati:
		return GU
	case Hebrew:
		return HE
	case Hindi:
		return HI
	case Hungarian:
		return HU
	case Icelandic:
		return IS
	case Indonesian:
		return ID
	case Irish:
		return GA
	case Italian:
		return IT
	case Japanese:
		return JA
	case Kazakh:
		return KK
	case Korean:
		return KO
	case Latin:
		return LA
	case Latvian:
		return LV
	case Lithuanian:
		return LT
	case Macedonian:
		return MK
	case Malay:
		return MS
	case Maori:
		return MI
	case Marathi:
		return MR
	case Mongolian:
		return MN
	case Nynorsk:
		return NN
	case Persian:
		return FA
	case Polish:
		return PL
	case Portuguese:
		return PT
	case Punjabi:
		return PA
	case Romanian:
		return RO
	case Russian:
		return RU
	case Serbian:
		return SR
	case Shona:
		return SN
	case Slovak:
		return SK
	case Slovene:
		return SL
	case Somali:
		return SO
	case Sotho:
		return ST
	case Spanish:
		return ES
	case Swahili:
		return SW
	case Swedish:
		return SV
	case Tagalog:
		return TL
	case Tamil:
		return TA
	case Telugu:
		return TE
	case Thai:
		return TH
	case Tsonga:
		return TS
	case Tswana:
		return TN
	case Turkish:
		return TR
	case Ukrainian:
		return UK
	case Urdu:
		return UR
	case Vietnamese:
		return VI
	case Welsh:
		return CY
	case Xhosa:
		return XH
	case Yoruba:
		return YO
	case Zulu:
		return ZU
	case Unknown:
		return UnknownIsoCode639_1
	default:
		return -1
	}
}

// IsoCode639_3 returns a language's ISO 639-3 code.
func (language Language) IsoCode639_3() IsoCode639_3 {
	switch language {
	case Afrikaans:
		return AFR
	case Albanian:
		return SQI
	case Arabic:
		return ARA
	case Armenian:
		return HYE
	case Azerbaijani:
		return AZE
	case Basque:
		return EUS
	case Belarusian:
		return BEL
	case Bengali:
		return BEN
	case Bokmal:
		return NOB
	case Bosnian:
		return BOS
	case Bulgarian:
		return BUL
	case Catalan:
		return CAT
	case Chinese:
		return ZHO
	case Croatian:
		return HRV
	case Czech:
		return CES
	case Danish:
		return DAN
	case Dutch:
		return NLD
	case English:
		return ENG
	case Esperanto:
		return EPO
	case Estonian:
		return EST
	case Finnish:
		return FIN
	case French:
		return FRA
	case Ganda:
		return LUG
	case Georgian:
		return KAT
	case German:
		return DEU
	case Greek:
		return ELL
	case Gujarati:
		return GUJ
	case Hebrew:
		return HEB
	case Hindi:
		return HIN
	case Hungarian:
		return HUN
	case Icelandic:
		return ISL
	case Indonesian:
		return IND
	case Irish:
		return GLE
	case Italian:
		return ITA
	case Japanese:
		return JPN
	case Kazakh:
		return KAZ
	case Korean:
		return KOR
	case Latin:
		return LAT
	case Latvian:
		return LAV
	case Lithuanian:
		return LIT
	case Macedonian:
		return MKD
	case Malay:
		return MSA
	case Maori:
		return MRI
	case Marathi:
		return MAR
	case Mongolian:
		return MON
	case Nynorsk:
		return NNO
	case Persian:
		return FAS
	case Polish:
		return POL
	case Portuguese:
		return POR
	case Punjabi:
		return PAN
	case Romanian:
		return RON
	case Russian:
		return RUS
	case Serbian:
		return SRP
	case Shona:
		return SNA
	case Slovak:
		return SLK
	case Slovene:
		return SLV
	case Somali:
		return SOM
	case Sotho:
		return SOT
	case Spanish:
		return SPA
	case Swahili:
		return SWA
	case Swedish:
		return SWE
	case Tagalog:
		return TGL
	case Tamil:
		return TAM
	case Telugu:
		return TEL
	case Thai:
		return THA
	case Tsonga:
		return TSO
	case Tswana:
		return TSN
	case Turkish:
		return TUR
	case Ukrainian:
		return UKR
	case Urdu:
		return URD
	case Vietnamese:
		return VIE
	case Welsh:
		return CYM
	case Xhosa:
		return XHO
	case Yoruba:
		return YOR
	case Zulu:
		return ZUL
	case Unknown:
		return UnknownIsoCode639_3
	default:
		return -1
	}
}

func (language Language) alphabets() []alphabet {
	switch language {
	case
		Afrikaans,
		Albanian,
		Azerbaijani,
		Basque,
		Bokmal,
		Bosnian,
		Catalan,
		Croatian,
		Czech,
		Danish,
		Dutch,
		English,
		Esperanto,
		Estonian,
		Finnish,
		French,
		Ganda,
		German,
		Hungarian,
		Icelandic,
		Indonesian,
		Irish,
		Italian,
		Latin,
		Latvian,
		Lithuanian,
		Malay,
		Maori,
		Nynorsk,
		Polish,
		Portuguese,
		Romanian,
		Shona,
		Slovak,
		Slovene,
		Somali,
		Sotho,
		Spanish,
		Swahili,
		Swedish,
		Tagalog,
		Tsonga,
		Tswana,
		Turkish,
		Vietnamese,
		Welsh,
		Xhosa,
		Yoruba,
		Zulu:
		return []alphabet{latin}
	case
		Belarusian,
		Bulgarian,
		Kazakh,
		Macedonian,
		Mongolian,
		Russian,
		Serbian,
		Ukrainian:
		return []alphabet{cyrillic}
	case Arabic, Persian, Urdu:
		return []alphabet{arabic}
	case Hindi, Marathi:
		return []alphabet{devanagari}
	case Armenian:
		return []alphabet{armenian}
	case Bengali:
		return []alphabet{bengali}
	case Chinese:
		return []alphabet{han}
	case Georgian:
		return []alphabet{georgian}
	case Greek:
		return []alphabet{greek}
	case Gujarati:
		return []alphabet{gujarati}
	case Hebrew:
		return []alphabet{hebrew}
	case Japanese:
		return []alphabet{hiragana, katakana, han}
	case Korean:
		return []alphabet{hangul}
	case Punjabi:
		return []alphabet{gurmukhi}
	case Tamil:
		return []alphabet{tamil}
	case Telugu:
		return []alphabet{telugu}
	case Thai:
		return []alphabet{thai}
	default:
		return []alphabet{}
	}
}

func (language Language) uniqueCharacters() string {
	switch language {
	case Azerbaijani:
		return "Əə"
	case Catalan:
		return "Ïï"
	case Czech:
		return "ĚěŘřŮů"
	case Esperanto:
		return "ĈĉĜĝĤĥĴĵŜŝŬŭ"
	case German:
		return "ß"
	case Hungarian:
		return "ŐőŰű"
	case Kazakh:
		return "ӘәҒғҚқҢңҰұ"
	case Latvian:
		return "ĢģĶķĻļŅņ"
	case Lithuanian:
		return "ĖėĮįŲų"
	case Macedonian:
		return "ЃѓЅѕЌќЏџ"
	case Marathi:
		return "ळ"
	case Mongolian:
		return "ӨөҮү"
	case Polish:
		return "ŁłŃńŚśŹź"
	case Romanian:
		return "Țţ"
	case Serbian:
		return "ЂђЋћ"
	case Slovak:
		return "ĹĺĽľŔŕ"
	case Spanish:
		return "¿¡"
	case Ukrainian:
		return "ҐґЄєЇї"
	case Vietnamese:
		return "ẰằẦầẲẳẨẩẴẵẪẫẮắẤấẠạẶặẬậỀềẺẻỂểẼẽỄễẾếỆệỈỉĨĩỊịƠơỒồỜờỎỏỔổỞởỖỗỠỡỐốỚớỘộỢợƯưỪừỦủỬửŨũỮữỨứỤụỰựỲỳỶỷỸỹỴỵ"
	case Yoruba:
		return "ŌōṢṣ"
	default:
		return ""
	}
}
