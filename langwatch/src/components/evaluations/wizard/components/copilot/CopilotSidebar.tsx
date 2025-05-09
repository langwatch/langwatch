import { Heading, VStack, Box, Text, HStack, IconButton, Card, Icon, Textarea, Flex } from "@chakra-ui/react";
import { Prose } from "~/components/ui/prose";
import { motion } from "motion/react";
import { useChat, type Message } from "@ai-sdk/react";
import type React from "react";
import { useState } from "react";
import { LuBot, LuEllipsis, LuSend } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import type { tools } from "~/app/api/copilot/generate/tools.shared";
import type { z } from "zod";
import { Markdown } from "~/components/Markdown";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationWizardStore } from "../../hooks/evaluation-wizard-store/useEvaluationWizardStore";

const MotionBox = motion.create(Box);

const CopilotSidebar: React.FC = () => {
  const [focused, setFocused] = useState(false);
  const { project } = useOrganizationTeamProject();
  const { setCode, code } = useEvaluationWizardStore(useShallow(state => {
    return {
      setCode: state.copilotStore.setCode,
      code: state.copilotStore.code,
    }
  }));

  const { messages, handleSubmit, input, setInput, status } = useChat({
    api: "/api/copilot/generate",
    body: {
      currentCode: code,
      projectId: project?.id,
    },
    maxSteps: 20,
    onError: (error) => {
      console.error(error);
      toaster.create({
        title: "Error",
        description: error.message,
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    },
    onToolCall: async (toolCall) => {
      const toolExecutor: {
        [T in keyof typeof tools]: (
          args: z.infer<(typeof tools)[T]["parameters"]>
        ) => Promise<any>;
      } = {
        generateCode: async ({ newCode }) => {
          setCode(newCode);
          return { success: true };
        },
      };

      const tool =
        toolExecutor[toolCall.toolCall.toolName as keyof typeof tools];

      if (!tool) {
        toaster.create({
          title: "Error",
          description: `Unknown tool: ${toolCall.toolCall.toolName}`,
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
        });
        return { error: `Unknown tool: ${toolCall.toolCall.toolName}` };
      }

      let result: any;
      try {
        result = await tool(toolCall.toolCall.args as any);
      } catch (error) {
        console.error(error);
        toaster.create({
          title: "Error",
          description: "An error occurred while executing the tool",
          type: "error",
          duration: 5000,
          meta: {
            closable: true,
          },
        });
      }

      return result;
    },
  });

  const disabled = ["submitted", "streaming"].includes(status) || input.length === 0;

  if (typeof window !== "undefined") {
    (window as any).messages = messages;
  }

  function handleSend() {
    handleSubmit();
  }

  return (
    <VStack
      position="relative"
      minWidth="600px"
      width="full"
      maxWidth="600px"
      height="full"
      align="stretch"
      p={4}
      overflow={'hidden'}
      gap={0}
    >
      <HStack
        position={'absolute'}
        bottom={'-50px'} left={0} right={0}
        justify={'center'}
        gap={0}
        filter={'blur(80px)'}
      >
        <MotionBox
          animate={{ height: ['120px', '190px', '120px'] }}
          transition={{ duration: 30, repeat: Infinity, repeatType: 'mirror' }}
          width={'40%'} background={'red.400'} opacity={1}
        />
        <MotionBox
          animate={{ height: ['120px', '190px', '120px'] }}
          transition={{ duration: 25, repeat: Infinity, repeatType: 'mirror' }}
          width={'20%'} background={'blue.400'} opacity={1}
        />
        <MotionBox
          animate={{ height: ['120px', '190px', '120px'] }}
          transition={{ duration: 35, repeat: Infinity, repeatType: 'mirror' }}
          width={'40%'} background={'green.400'} opacity={1}
        />
      </HStack>

      <Heading size="md" textAlign="center" mb={4}>Evaluator Copilot ✨</Heading>
      <Box
        flex={1}
        overflowY="auto"
        h={'100%'}
        maxW={'100%'}
        minW={'100%'}
        maxHeight="calc(100vh - 228px)"
        pb="80px"
        mr={-4}
        pr={4}
        flexShrink={1}
        minHeight={0}
      >
        <VStack align="stretch" gap={3}>
          <Box bg="gray.100" p={3} borderRadius="md" alignSelf="flex-start">
            <Text fontSize="sm">Let's get you evaluating your LLM application.</Text>
          </Box>
          {messages.map((message) => (
            <Box
              key={message.id}
              bg={message.role === 'user' ? 'blue.100' : 'gray.100'}
              px={3}
              py={-3}
              borderRadius="xl"
              alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'}
            >
              <Text fontSize="sm">
                <Prose>
                  <Markdown>
                    {message.content}
                  </Markdown>
                </Prose>
              </Text>
            </Box>
          ))}
          {status === 'submitted' && (
            <Box
              bg={'gray.100'}
              p={3}
              borderRadius="xl"
              alignSelf="flex-start"
            >
              <LuEllipsis />
            </Box>
          )}
        </VStack>
      </Box>
      <Card.Root
        variant={'outline'}
        w={'full'}
        borderColor={focused ? 'orange.500' : 'border'}
        blur={'sm'}
        background={'rgb(255 255 255 / 60%)'}
      >
        <Card.Body p={2}>
          <HStack alignItems={'flex-start'} pb={2} pl={1} gap={0}>
            <Icon
              mt={'9px'}
              color={focused ? 'orange.500' : 'gray.500'}
            >
              <LuBot />
            </Icon>
            <Textarea
              border={'none'}
              autoresize
              autoFocus
              maxH={'40'}
              placeholder={'Let\'s evaluate together'}
              variant={'outline'}
              _focus={{ border: 'transparent', outline: 'transparent' }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
          </HStack>
          <Flex justify={'space-between'} gap={4}>
            <div />
            <Flex justify={'flex-end'} align={'center'} gap={2}>
              <IconButton
                aria-label={'Send message'}
                disabled={disabled}
                variant={'ghost'}
                size={'2xs'}
                onClick={() => {
                  handleSend();
                }}
              >
                <LuSend />
              </IconButton>
            </Flex>
          </Flex>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
};

const ConversationCard: React.FC<{ message: Message }> = ({ message }) => {
  return (
    <Box>
      <Text>{message.content}</Text>
    </Box>
  );
};

export default CopilotSidebar;
