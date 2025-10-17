import { Box, Group, Input, NativeSelect } from "@chakra-ui/react";
import React, { useEffect, useMemo, useState } from "react";
import {
  AsYouType,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  type CountryCode,
} from "libphonenumber-js";
import {
  countryCodeToFlagEmoji,
  countryCodeToName,
  DEFAULT_COUNTRIES,
  splitByPopularity,
} from "../../utils/countries";

export interface PhoneNumberInputProps {
  value?: string;
  defaultCountry?: CountryCode;
  allowedCountries?: ReadonlyArray<CountryCode>;
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

export function PhoneNumberInput(
  props: PhoneNumberInputProps,
): React.JSX.Element {
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

  const initialCountry: CountryCode = useMemo(() => {
    if (value) {
      const parsed = parsePhoneNumberFromString(value);

      if (parsed?.country) return parsed.country;
    }

    return allowedCountries.includes(defaultCountry)
      ? defaultCountry
      : allowedCountries[0] ?? defaultCountry;
  }, [value, defaultCountry, allowedCountries]);

  const [country, setCountry] = useState<CountryCode>(initialCountry);
  const [nationalInput, setNationalInput] = useState<string>("");
  const [didDetectOnce, setDidDetectOnce] = useState<boolean>(false);
  const [hasUserInteracted, setHasUserInteracted] = useState<boolean>(false);

  // Sync displayed value from external E.164 value when it changes
  useEffect(() => {
    if (!value) {
      setNationalInput("");
      return;
    }

    const parsed = parsePhoneNumberFromString(value);
    if (parsed) {
      setNationalInput(parsed.formatNational());
    }
  }, [value, country]);

  const handleCountryChange = (next: CountryCode) => {
    setHasUserInteracted(true);
    setCountry(next);

    const formatted = formatNational(nationalInput.replace(/\D+/g, ""), next);
    setNationalInput(formatted);

    const e164 = e164FromInput(formatted, next);
    const valid = e164 ? isValidPhoneNumber(e164) : false;

    onChange?.(e164, {
      country: next,
      national: parsedNational(formatted, next),
      formatted,
      isValid: Boolean(valid),
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatNational(raw, country);
    setNationalInput(formatted);
    setHasUserInteracted(true);

    const e164 = e164FromInput(formatted, country);
    const valid = e164 ? isValidPhoneNumber(e164) : false;
    onChange?.(e164, {
      country,
      national: parsedNational(formatted, country),
      formatted,
      isValid: Boolean(valid),
    });
  };

  // Detect default country once on mount when enabled
  useEffect(() => {
    if (!autoDetectDefaultCountry) return;
    if (didDetectOnce) return;
    if (value) return; // respect explicit value
    if (props.defaultCountry !== void 0) return; // respect provided defaultCountry prop
    if (hasUserInteracted) return;
    if (nationalInput) return;

    let cancelled = false;

    const choose = (c?: string) => {
      if (cancelled || !c) return;

      const candidate = (c || "").toUpperCase() as CountryCode;

      if (!allowedCountries.includes(candidate)) return;

      setCountry(candidate);
      setDidDetectOnce(true);
    };

    // 1) Try meta tag hint injected by server/edge
    try {
      const meta = document.querySelector(
        'meta[name="x-country"]',
      ) as HTMLMetaElement | null;
      if (meta?.content) {
        choose(meta.content);
        return () => {
          cancelled = true;
        };
      }
    } catch { /* fallthrough */ }

    // 2) Try to detect with locale detection
    try {
      const lang = navigator.languages?.[0] || navigator.language;
      if (lang) {
        const loc = new Intl.Locale(lang);
        if (loc.region) return choose(loc.region);
      }
    } catch { /* fallthrough */ }

    return () => {
      cancelled = true;
    };
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
          >
            {(() => {
              const renderOption = (code: CountryCode) => {
                const calling = getCountryCallingCode(code);
                const flag = countryCodeToFlagEmoji(code);
                const countryName = countryCodeToName[code as keyof typeof countryCodeToName];
                return (
                  <option key={code} value={code}>
                    {`${countryName} ${flag} (+${calling})`}
                  </option>
                );
              };

              if (groupFrequentlyUsedCountries) {
                const { popular, others } = splitByPopularity(allowedCountries);
                return (
                  <>
                    <optgroup label="Popular">
                      {popular.map(renderOption)}
                    </optgroup>
                    <optgroup label="All countries">
                      {others.map(renderOption)}
                    </optgroup>
                  </>
                );
              }

              return allowedCountries.map(renderOption);
            })()}
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
          color="inherit"
        >
          {`${countryCodeToFlagEmoji(country)} +${getCountryCallingCode(
            country,
          )}`}
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

function formatNational(input: string, country: CountryCode): string {
  const formatter = new AsYouType(country);
  return formatter.input(input);
}

function e164FromInput(
  input: string,
  country: CountryCode,
): string | undefined {
  const parsed = parsePhoneNumberFromString(input, country);
  return parsed?.number;
}

function parsedNational(input: string, country: CountryCode): string {
  const parsed = parsePhoneNumberFromString(input, country);
  if (!parsed) return input;
  return parsed.formatNational();
}
