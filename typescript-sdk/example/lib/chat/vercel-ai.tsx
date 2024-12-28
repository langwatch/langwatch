import 'server-only'

import { openai } from '@ai-sdk/openai'
import {
  createAI,
  createStreamableUI,
  getAIState,
  getMutableAIState
} from 'ai/rsc'

import {
  BotCard,
  BotMessage,
  Purchase,
  spinner,
  Stock,
  SystemMessage
} from '@/components/stocks'

import { saveChat } from '@/app/actions'
import { auth } from '@/auth'
import { Events } from '@/components/stocks/events'
import { UserMessage } from '@/components/stocks/message'
import { Stocks } from '@/components/stocks/stocks'
import { Chat, Message } from '@/lib/types'
import {
  formatNumber,
  nanoid,
  runAsyncFnWithoutBlocking,
  sleep
} from '@/lib/utils'
import { generateText, streamText, tool } from 'ai'
import { z } from 'zod'
import { StockSkeleton } from '../../components/stocks/stock-skeleton'
import { EventsSkeleton } from '../../components/stocks/events-skeleton'

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })

  const system = `\
  You are a stock trading conversation bot and you can help users buy stocks, step by step.
  You and the user can discuss stock prices and the user can adjust the amount of stocks they want to buy, or place an order, in the UI.

  To use tools, use the following format:
  - For stock price: show_stock_price(SYMBOL, PRICE, DELTA)
  - For listing stocks: list_stocks([{"symbol": "AAPL", "price": 150.5, "delta": 2.3}, ...])
  - For purchase UI: show_stock_purchase(SYMBOL, PRICE, NUMBER_OF_SHARES)
  - For events: get_events([{"date": "2024-01-01", "headline": "...", "description": "..."}, ...])

  Messages inside [] means that it's a UI element or a user event.`

  const ui = createStreamableUI(<BotMessage content="" />)
  // let textNode = <BotMessage content={textStream.value} />
  let fullContent = ''

  const onFinish = (output: Message[]) => {
    aiState.done({
      ...aiState.get(),
      messages: [...aiState.get().messages, ...output]
    })
  }

  const stream = streamText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: system
      },
      ...aiState.get().messages
    ],
    experimental_telemetry: {
      isEnabled: true,
      metadata: {
        threadId: aiState.get().chatId
      }
    },
    tools: {
      listStocks: tool({
        description: 'List three imaginary stocks that are trending.',
        parameters: z.object({
          stocks: z.array(
            z.object({
              symbol: z.string().describe('The symbol of the stock'),
              price: z.number().describe('The price of the stock'),
              delta: z.number().describe('The change in price of the stock')
            })
          )
        }),
        execute: async ({ stocks }) => {
          ui.update(
            <BotCard>
              <StockSkeleton />
            </BotCard>
          )

          await sleep(1000)

          const toolCallId = nanoid()

          onFinish([
            {
              id: nanoid(),
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolName: 'listStocks',
                  toolCallId,
                  args: { stocks }
                }
              ]
            },
            {
              id: nanoid(),
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'listStocks',
                  toolCallId,
                  result: stocks
                }
              ]
            }
          ])

          ui.update(
            <BotCard>
              <Stocks props={stocks} />
            </BotCard>
          )
        }
      }),
      showStockPrice: tool({
        description:
          'Get the current stock price of a given stock or currency. Use this to show the price to the user.',
        parameters: z.object({
          symbol: z
            .string()
            .describe(
              'The name or symbol of the stock or currency. e.g. DOGE/AAPL/USD.'
            ),
          price: z.number().describe('The price of the stock.'),
          delta: z.number().describe('The change in price of the stock')
        }),
        execute: async ({ symbol, price, delta }) => {
          ui.update(
            <BotCard>
              <StockSkeleton />
            </BotCard>
          )

          await sleep(1000)

          const toolCallId = nanoid()

          onFinish([
            {
              id: nanoid(),
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolName: 'showStockPrice',
                  toolCallId,
                  args: { symbol, price, delta }
                }
              ]
            },
            {
              id: nanoid(),
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'showStockPrice',
                  toolCallId,
                  result: { symbol, price, delta }
                }
              ]
            }
          ])

          ui.update(
            <BotCard>
              <Stock props={{ symbol, price, delta }} />
            </BotCard>
          )
        }
      }),
      showStockPurchase: tool({
        description:
          'Show price and the UI to purchase a stock or currency. Use this if the user wants to purchase a stock or currency.',
        parameters: z.object({
          symbol: z
            .string()
            .describe(
              'The name or symbol of the stock or currency. e.g. DOGE/AAPL/USD.'
            ),
          price: z.number().describe('The price of the stock.'),
          numberOfShares: z
            .number()
            .describe(
              'The **number of shares** for a stock or currency to purchase. Can be optional if the user did not specify it.'
            )
        }),
        execute: async ({ symbol, price, numberOfShares = 100 }) => {
          const toolCallId = nanoid()

          if (numberOfShares <= 0 || numberOfShares > 1000) {
            onFinish([
              {
                id: nanoid(),
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolName: 'showStockPurchase',
                    toolCallId,
                    args: { symbol, price, numberOfShares }
                  }
                ]
              },
              {
                id: nanoid(),
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'showStockPurchase',
                    toolCallId,
                    result: {
                      symbol,
                      price,
                      numberOfShares,
                      status: 'expired'
                    }
                  }
                ]
              },
              {
                id: nanoid(),
                role: 'system',
                content: `[User has selected an invalid amount]`
              }
            ])

            ui.update(<BotMessage content={'Invalid amount'} />)
          } else {
            onFinish([
              {
                id: nanoid(),
                role: 'assistant',
                content: [
                  {
                    type: 'tool-call',
                    toolName: 'showStockPurchase',
                    toolCallId,
                    args: { symbol, price, numberOfShares }
                  }
                ]
              },
              {
                id: nanoid(),
                role: 'tool',
                content: [
                  {
                    type: 'tool-result',
                    toolName: 'showStockPurchase',
                    toolCallId,
                    result: {
                      symbol,
                      price,
                      numberOfShares
                    }
                  }
                ]
              }
            ])

            ui.update(
              <BotCard>
                <Purchase
                  props={{
                    numberOfShares,
                    symbol,
                    price: +price,
                    status: 'requires_action'
                  }}
                />
              </BotCard>
            )
          }
        }
      }),
      getEvents: tool({
        description:
          'List funny imaginary events between user highlighted dates that describe stock activity.',
        parameters: z.object({
          events: z.array(
            z.object({
              date: z
                .string()
                .describe('The date of the event, in ISO-8601 format'),
              headline: z.string().describe('The headline of the event'),
              description: z.string().describe('The description of the event')
            })
          )
        }),
        execute: async ({ events }) => {
          ui.update(
            <BotCard>
              <EventsSkeleton />
            </BotCard>
          )

          await sleep(1000)

          const toolCallId = nanoid()

          onFinish([
            {
              id: nanoid(),
              role: 'assistant',
              content: [
                {
                  type: 'tool-call',
                  toolName: 'getEvents',
                  toolCallId,
                  args: { events }
                }
              ]
            },
            {
              id: nanoid(),
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'getEvents',
                  toolCallId,
                  result: events
                }
              ]
            }
          ])

          ui.update(
            <BotCard>
              <Events props={events} />
            </BotCard>
          )
        }
      })
    }
  })

  setTimeout(async () => {
    // First, stream all text chunks
    for await (const chunk of stream.textStream) {
      ui.update(<BotMessage content={fullContent} />)
      fullContent += chunk
    }

    ui.done()
    const toolCalls = await stream.toolCalls
    if (!toolCalls || toolCalls.length == 0) {
      aiState.done({
        ...aiState.get(),
        messages: [
          ...aiState.get().messages,
          {
            id: nanoid(),
            role: 'assistant',
            content: fullContent
          }
        ]
      })
    }
  }, 0)

  return {
    id: nanoid(),
    display: ui.value
  }
}

async function confirmPurchase(symbol: string, price: number, amount: number) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  const purchasing = createStreamableUI(
    <div className="inline-flex items-start gap-1 md:items-center">
      {spinner}
      <p className="mb-2">
        Purchasing {amount} ${symbol}...
      </p>
    </div>
  )

  const systemMessage = createStreamableUI(null)

  runAsyncFnWithoutBlocking(async () => {
    await sleep(1000)

    purchasing.update(
      <div className="inline-flex items-start gap-1 md:items-center">
        {spinner}
        <p className="mb-2">
          Purchasing {amount} ${symbol}... working on it...
        </p>
      </div>
    )

    await sleep(1000)

    purchasing.done(
      <div>
        <p className="mb-2">
          You have successfully purchased {amount} ${symbol}. Total cost:{' '}
          {formatNumber(amount * price)}
        </p>
      </div>
    )

    systemMessage.done(
      <SystemMessage>
        You have purchased {amount} shares of {symbol} at ${price}. Total cost ={' '}
        {formatNumber(amount * price)}.
      </SystemMessage>
    )

    aiState.done({
      ...aiState.get(),
      messages: [
        ...aiState.get().messages,
        {
          id: nanoid(),
          role: 'system',
          content: `[User has purchased ${amount} shares of ${symbol} at ${price}. Total cost = ${
            amount * price
          }]`
        }
      ]
    })
  })

  return {
    purchasingUI: purchasing.value,
    newMessage: {
      id: nanoid(),
      display: systemMessage.value
    }
  }
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage,
    confirmPurchase
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState()

      if (aiState) {
        // @ts-ignore
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'tool' ? (
          message.content.map(tool => {
            return tool.toolName === 'listStocks' ? (
              <BotCard>
                {/* TODO: Infer types based on the tool result*/}
                {/* @ts-expect-error */}
                <Stocks props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'showStockPrice' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Stock props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'showStockPurchase' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Purchase props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'getEvents' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Events props={tool.result} />
              </BotCard>
            ) : null
          })
        ) : message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}
