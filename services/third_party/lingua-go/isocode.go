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

import "strings"

// IsoCode639_1 is the type used for enumerating the ISO 639-1 code
// representations of the supported languages.
//
type IsoCode639_1 int

// IsoCode639_3 is the type used for enumerating the ISO 639-3 code
// representations of the supported languages.
//
type IsoCode639_3 int

const (
	// AF is the ISO 639-1 code for Afrikaans.
	AF IsoCode639_1 = iota

	// AR is the ISO 639-1 code for Arabic.
	AR

	// AZ is the ISO 639-1 code for Azerbaijani.
	AZ

	// BE is the ISO 639-1 code for Belarusian.
	BE

	// BG is the ISO 639-1 code for Bulgarian.
	BG

	// BN is the ISO 639-1 code for Bengali.
	BN

	// BS is the ISO 639-1 code for Bosnian.
	BS

	// CA is the ISO 639-1 code for Catalan.
	CA

	// CS is the ISO 639-1 code for Czech.
	CS

	// CY is the ISO 639-1 code for Welsh.
	CY

	// DA is the ISO 639-1 code for Danish.
	DA

	// DE is the ISO 639-1 code for German.
	DE

	// EL is the ISO 639-1 code for Greek.
	EL

	// EN is the ISO 639-1 code for English.
	EN

	// EO is the ISO 639-1 code for Esperanto.
	EO

	// ES is the ISO 639-1 code for Spanish.
	ES

	// ET is the ISO 639-1 code for Estonian.
	ET

	// EU is the ISO 639-1 code for Basque.
	EU

	// FA is the ISO 639-1 code for Persian.
	FA

	// FI is the ISO 639-1 code for Finnish.
	FI

	// FR is the ISO 639-1 code for French.
	FR

	// GA is the ISO 639-1 code for Irish.
	GA

	// GU is the ISO 639-1 code for Gujarati.
	GU

	// HE is the ISO 639-1 code for Hebrew.
	HE

	// HI is the ISO 639-1 code for Hindi.
	HI

	// HR is the ISO 639-1 code for Croatian.
	HR

	// HU is the ISO 639-1 code for Hungarian.
	HU

	// HY is the ISO 639-1 code for Armenian.
	HY

	// ID is the ISO 639-1 code for Indonesian.
	ID

	// IS is the ISO 639-1 code for Icelandic.
	IS

	// IT is the ISO 639-1 code for Italian.
	IT

	// JA is the ISO 639-1 code for Japanese.
	JA

	// KA is the ISO 639-1 code for Georgian.
	KA

	// KK is the ISO 639-1 code for Kazakh.
	KK

	// KO is the ISO 639-1 code for Korean.
	KO

	// LA is the ISO 639-1 code for Latin.
	LA

	// LG is the ISO 639-1 code for Ganda.
	LG

	// LT is the ISO 639-1 code for Lithuanian.
	LT

	// LV is the ISO 639-1 code for Latvian.
	LV

	// MI is the ISO 639-1 code for Maori.
	MI

	// MK is the ISO 639-1 code for Macedonian.
	MK

	// MN is the ISO 639-1 code for Mongolian.
	MN

	// MR is the ISO 639-1 code for Marathi.
	MR

	// MS is the ISO 639-1 code for Malay.
	MS

	// NB is the ISO 639-1 code for Bokmal.
	NB

	// NL is the ISO 639-1 code for Dutch.
	NL

	// NN is the ISO 639-1 code for Nynorsk.
	NN

	// PA is the ISO 639-1 code for Punjabi.
	PA

	// PL is the ISO 639-1 code for Polish.
	PL

	// PT is the ISO 639-1 code for Portuguese.
	PT

	// RO is the ISO 639-1 code for Romanian.
	RO

	// RU is the ISO 639-1 code for Russian.
	RU

	// SK is the ISO 639-1 code for Slovak.
	SK

	// SL is the ISO 639-1 code for Slovene.
	SL

	// SN is the ISO 639-1 code for Shona.
	SN

	// SO is the ISO 639-1 code for Somali.
	SO

	// SQ is the ISO 639-1 code for Albanian.
	SQ

	// SR is the ISO 639-1 code for Serbian.
	SR

	// ST is the ISO 639-1 code for Sotho.
	ST

	// SV is the ISO 639-1 code for Swedish.
	SV

	// SW is the ISO 639-1 code for Swahili.
	SW

	// TA is the ISO 639-1 code for Tamil.
	TA

	// TE is the ISO 639-1 code for Telugu.
	TE

	// TH is the ISO 639-1 code for Thai.
	TH

	// TL is the ISO 639-1 code for Tagalog.
	TL

	// TN is the ISO 639-1 code for Tswana.
	TN

	// TR is the ISO 639-1 code for Turkish.
	TR

	// TS is the ISO 639-1 code for Tsonga.
	TS

	// UK is the ISO 639-1 code for Ukrainian.
	UK

	// UR is the ISO 639-1 code for Urdu.
	UR

	// VI is the ISO 639-1 code for Vietnamese.
	VI

	// XH is the ISO 639-1 code for Xhosa.
	XH

	// YO is the ISO 639-1 code for Yoruba.
	YO

	// ZH is the ISO 639-1 code for Chinese.
	ZH

	// ZU is the ISO 639-1 code for Zulu.
	ZU

	// UnknownIsoCode639_1 is the ISO 639-1 code for Unknown.
	UnknownIsoCode639_1
)

const (
	// AFR is the ISO 639-3 code for Afrikaans.
	AFR IsoCode639_3 = iota

	// ARA is the ISO 639-3 code for Arabic.
	ARA

	// AZE is the ISO 639-3 code for Azerbaijani.
	AZE

	// BEL is the ISO 639-3 code for Belarusian.
	BEL

	// BEN is the ISO 639-3 code for Bengali.
	BEN

	// BOS is the ISO 639-3 code for Bosnian.
	BOS

	// BUL is the ISO 639-3 code for Bulgarian.
	BUL

	// CAT is the ISO 639-3 code for Catalan.
	CAT

	// CES is the ISO 639-3 code for Czech.
	CES

	// CYM is the ISO 639-3 code for Welsh.
	CYM

	// DAN is the ISO 639-3 code for Danish.
	DAN

	// DEU is the ISO 639-3 code for German.
	DEU

	// ELL is the ISO 639-3 code for Greek.
	ELL

	// ENG is the ISO 639-3 code for English.
	ENG

	// EPO is the ISO 639-3 code for Esperanto.
	EPO

	// EST is the ISO 639-3 code for Estonian.
	EST

	// EUS is the ISO 639-3 code for Basque.
	EUS

	// FAS is the ISO 639-3 code for Persian.
	FAS

	// FIN is the ISO 639-3 code for Finnish.
	FIN

	// FRA is the ISO 639-3 code for French.
	FRA

	// GLE is the ISO 639-3 code for Irish.
	GLE

	// GUJ is the ISO 639-3 code for Gujarati.
	GUJ

	// HEB is the ISO 639-3 code for Hebrew.
	HEB

	// HIN is the ISO 639-3 code for Hindi.
	HIN

	// HRV is the ISO 639-3 code for Croatian.
	HRV

	// HUN is the ISO 639-3 code for Hungarian.
	HUN

	// HYE is the ISO 639-3 code for Armenian.
	HYE

	// IND is the ISO 639-3 code for Indonesian.
	IND

	// ISL is the ISO 639-3 code for Icelandic.
	ISL

	// ITA is the ISO 639-3 code for Italian.
	ITA

	// JPN is the ISO 639-3 code for Japanese.
	JPN

	// KAT is the ISO 639-3 code for Georgian.
	KAT

	// KAZ is the ISO 639-3 code for Kazakh.
	KAZ

	// KOR is the ISO 639-3 code for Korean.
	KOR

	// LAT is the ISO 639-3 code for Latin.
	LAT

	// LAV is the ISO 639-3 code for Latvian.
	LAV

	// LIT is the ISO 639-3 code for Lithuanian.
	LIT

	// LUG is the ISO 639-3 code for Ganda.
	LUG

	// MAR is the ISO 639-3 code for Marathi.
	MAR

	// MKD is the ISO 639-3 code for Macedonian.
	MKD

	// MON is the ISO 639-3 code for Mongolian.
	MON

	// MRI is the ISO 639-3 code for Maori.
	MRI

	// MSA is the ISO 639-3 code for Malay.
	MSA

	// NLD is the ISO 639-3 code for Dutch.
	NLD

	// NNO is the ISO 639-3 code for Nynorsk.
	NNO

	// NOB is the ISO 639-3 code for Bokmal.
	NOB

	// PAN is the ISO 639-3 code for Punjabi.
	PAN

	// POL is the ISO 639-3 code for Polish.
	POL

	// POR is the ISO 639-3 code for Portuguese.
	POR

	// RON is the ISO 639-3 code for Romanian.
	RON

	// RUS is the ISO 639-3 code for Russian.
	RUS

	// SLK is the ISO 639-3 code for Slovak.
	SLK

	// SLV is the ISO 639-3 code for Slovene.
	SLV

	// SNA is the ISO 639-3 code for Shona.
	SNA

	// SOM is the ISO 639-3 code for Somali.
	SOM

	// SOT is the ISO 639-3 code for Sotho.
	SOT

	// SPA is the ISO 639-3 code for Spanish.
	SPA

	// SQI is the ISO 639-3 code for Albanian.
	SQI

	// SRP is the ISO 639-3 code for Serbian.
	SRP

	// SWA is the ISO 639-3 code for Swahili.
	SWA

	// SWE is the ISO 639-3 code for Swedish.
	SWE

	// TAM is the ISO 639-3 code for Tamil.
	TAM

	// TEL is the ISO 639-3 code for Telugu.
	TEL

	// TGL is the ISO 639-3 code for Tagalog.
	TGL

	// THA is the ISO 639-3 code for Thai.
	THA

	// TSN is the ISO 639-3 code for Tswana.
	TSN

	// TSO is the ISO 639-3 code for Tsonga.
	TSO

	// TUR is the ISO 639-3 code for Turkish.
	TUR

	// UKR is the ISO 639-3 code for Ukrainian.
	UKR

	// URD is the ISO 639-3 code for Urdu.
	URD

	// VIE is the ISO 639-3 code for Vietnamese.
	VIE

	// XHO is the ISO 639-3 code for Xhosa.
	XHO

	// YOR is the ISO 639-3 code for Yoruba.
	YOR

	// ZHO is the ISO 639-3 code for Chinese.
	ZHO

	// ZUL is the ISO 639-3 code for Zulu.
	ZUL

	// UnknownIsoCode639_3 is the ISO 639-3 code for Unknown.
	UnknownIsoCode639_3
)

// GetIsoCode639_1FromValue returns the ISO 639-1 code for the given name.
func GetIsoCode639_1FromValue(name string) IsoCode639_1 {
	if isoCodeEnum, ok := stringToIsoCode639_1[strings.ToLower(name)]; ok {
		return isoCodeEnum
	}
	return UnknownIsoCode639_1
}

// GetIsoCode639_3FromValue returns the ISO 639-3 code for the given name.
func GetIsoCode639_3FromValue(name string) IsoCode639_3 {
	if isoCodeEnum, ok := stringToIsoCode639_3[strings.ToLower(name)]; ok {
		return isoCodeEnum
	}
	return UnknownIsoCode639_3
}

var stringToIsoCode639_1 = func() map[string]IsoCode639_1 {
	m := make(map[string]IsoCode639_1)
	for isoCode := AF; isoCode <= ZU; isoCode++ {
		m[strings.ToLower(isoCode.String())] = isoCode
	}
	return m
}()

var stringToIsoCode639_3 = func() map[string]IsoCode639_3 {
	m := make(map[string]IsoCode639_3)
	for isoCode := AFR; isoCode <= ZUL; isoCode++ {
		m[strings.ToLower(isoCode.String())] = isoCode
	}
	return m
}()
