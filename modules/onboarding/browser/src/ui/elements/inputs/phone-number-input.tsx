import { Box, Group, Input, NativeSelect } from "@chakra-ui/react";
import {
  AsYouType,
  type CountryCode,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

import {
  countryCodeToFlagEmoji,
  countryCodeToName,
  DEFAULT_COUNTRIES,
  splitByPopularity,
} from "../../../model/countries.ts";

export interface PhoneNumberInputProps {
  value?: string;
  defaultCountry?: CountryCode;
  allowedCountries?: readonly CountryCode[];
  groupFrequentlyUsedCountries?: boolean;
  autoDetectDefaultCountry?: boolean;
  onChange?: (
    value: string | undefined,
    meta: {
      country: CountryCode;
      national: string;
      formatted: string;
      isValid: boolean;
    },
  ) => void;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

export function PhoneNumberInput(props: PhoneNumberInputProps): React.JSX.Element {
  const {
    value,
    defaultCountry = "US",
    allowedCountries = DEFAULT_COUNTRIES,
    groupFrequentlyUsedCountries = true,
    autoDetectDefaultCountry,
    onChange,
    onFocus,
    onBlur,
  } = props;

  const initialCountry: CountryCode = useMemo(
    () => pickInitialCountry({ value, defaultCountry, allowedCountries }),
    [value, defaultCountry, allowedCountries],
  );

  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [nationalInput, setNationalInput] = useState<string>("");
  const [didDetectOnce, setDidDetectOnce] = useState<boolean>(false);
  const [hasUserInteracted, setHasUserInteracted] = useState<boolean>(false);

  // Sync displayed value from external E.164 value when it changes
  useEffect(() => {
    if (!value) {
      if (!hasUserInteracted) {
        setNationalInput("");
      }
      return;
    }

    const parsed = parsePhoneNumberFromString(value);
    if (parsed) {
      setNationalInput(parsed.formatNational());
    }
  }, [value, country, hasUserInteracted]);

  const handleCountryChange = (next: CountryCode) => {
    setHasUserInteracted(true);
    setCountry(next);

    const formatted = formatNational(nationalInput.replace(/\D+/g, ""), next);
    setNationalInput(formatted);

    onChange?.(...describePhoneInput({ formatted, country: next }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatNational(raw, country);
    setNationalInput(formatted);
    setHasUserInteracted(true);

    onChange?.(...describePhoneInput({ formatted, country }));
  };

  // Detect default country once on mount when enabled
  useEffect(() => {
    if (!autoDetectDefaultCountry || didDetectOnce) return;
    // An explicit value or defaultCountry prop wins over detection.
    if (value || props.defaultCountry !== void 0) return;
    if (hasUserInteracted || nationalInput) return;

    const detected = detectAllowedCountry(allowedCountries);
    if (!detected) return;

    setCountry(detected);
    setDidDetectOnce(true);
  }, [
    autoDetectDefaultCountry,
    didDetectOnce,
    value,
    props.defaultCountry,
    hasUserInteracted,
    nationalInput,
    allowedCountries,
  ]);

  return (
    <Group attached w="full">
      <Box position="relative" w="9em" zIndex={1}>
        <NativeSelect.Root
          size="md"
          position="relative"
          zIndex={1}
          w="full"
          aria-label="Country calling code"
        >
          <NativeSelect.Field
            borderRightRadius={0}
            value={country}
            onChange={(e) => handleCountryChange(e.target.value as CountryCode)}
            color="transparent"
            textShadow="0 0 0 transparent"
            css={{
              colorScheme: "light dark",
              "& option, & optgroup": {
                color: "CanvasText",
                backgroundColor: "Canvas",
              },
            }}
          >
            <CountryOptions
              allowedCountries={allowedCountries}
              grouped={groupFrequentlyUsedCountries}
            />
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Box
          pointerEvents="none"
          position="absolute"
          inset="0"
          display="flex"
          alignItems="center"
          px="3"
          pr="8"
          color="fg"
        >
          {`${countryCodeToFlagEmoji(country)} +${getCountryCallingCode(country)}`}
        </Box>
      </Box>

      <Input
        value={nationalInput}
        onChange={handleInputChange}
        inputMode="tel"
        autoComplete="tel"
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </Group>
  );
}

export default PhoneNumberInput;

function CountryOptions({
  allowedCountries,
  grouped,
}: {
  allowedCountries: readonly CountryCode[];
  grouped: boolean;
}): React.JSX.Element {
  if (!grouped) return <>{allowedCountries.map(renderCountryOption)}</>;

  const { popular, others } = splitByPopularity(allowedCountries);
  return (
    <>
      <optgroup label="Popular">{popular.map(renderCountryOption)}</optgroup>
      <optgroup label="All countries">{others.map(renderCountryOption)}</optgroup>
    </>
  );
}

function renderCountryOption(code: CountryCode): React.JSX.Element {
  const calling = getCountryCallingCode(code);
  const flag = countryCodeToFlagEmoji(code);
  const countryName = countryCodeToName[code as keyof typeof countryCodeToName];
  return (
    <option key={code} value={code}>
      {`${countryName} ${flag} (+${calling})`}
    </option>
  );
}

function pickInitialCountry({
  value,
  defaultCountry,
  allowedCountries,
}: {
  value: string | undefined;
  defaultCountry: CountryCode;
  allowedCountries: readonly CountryCode[];
}): CountryCode {
  const valueCountry = value ? parsePhoneNumberFromString(value)?.country : undefined;
  if (valueCountry) return valueCountry;

  return allowedCountries.includes(defaultCountry)
    ? defaultCountry
    : (allowedCountries[0] ?? defaultCountry);
}

function describePhoneInput({
  formatted,
  country,
}: {
  formatted: string;
  country: CountryCode;
}): Parameters<NonNullable<PhoneNumberInputProps["onChange"]>> {
  const e164 = e164FromInput(formatted, country);
  const valid = e164 ? isValidPhoneNumber(e164) : false;
  return [
    e164,
    { country, national: parsedNational(formatted, country), formatted, isValid: Boolean(valid) },
  ];
}

function detectAllowedCountry(allowedCountries: readonly CountryCode[]): CountryCode | undefined {
  const detected = (readMetaCountry() || readLocaleCountry())?.toUpperCase();
  return allowedCountries.find((code) => code === detected);
}

function formatNational(input: string, country: CountryCode): string {
  const formatter = new AsYouType(country);
  return formatter.input(input);
}

function e164FromInput(input: string, country: CountryCode): string | undefined {
  const parsed = parsePhoneNumberFromString(input, country);
  return parsed?.number;
}

function parsedNational(input: string, country: CountryCode): string {
  const parsed = parsePhoneNumberFromString(input, country);
  if (!parsed) return input;
  return parsed.formatNational();
}

function readMetaCountry(): string | undefined {
  try {
    const meta = document.querySelector('meta[name="x-country"]');
    return meta instanceof HTMLMetaElement ? meta.content : undefined;
  } catch {
    return undefined;
  }
}

function readLocaleCountry(): string | undefined {
  try {
    const lang = navigator.languages?.[0] || navigator.language;
    if (!lang) return undefined;

    return new Intl.Locale(lang).region;
  } catch {
    return undefined;
  }
}
