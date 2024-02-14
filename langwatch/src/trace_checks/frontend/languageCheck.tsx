import { Text, VStack } from '@chakra-ui/react';
import type { TraceCheck } from '../../server/tracer/types';
import type { LanguageCheckApiResponse } from '../types';

export function LanguageCheck({ check }: { check: TraceCheck }) {
  const languageResult = check.raw_result as LanguageCheckApiResponse | undefined;
  const { languages } = languageResult ?? {};

  return (
    <VStack align="start">
      <Text>Input Language: {languages?.input?.join(', ') ?? "Too small to detect"}</Text>
      <Text>Output Language: {languages?.output?.join(', ') ?? "Too small to detect"}</Text>
    </VStack>
  );
}