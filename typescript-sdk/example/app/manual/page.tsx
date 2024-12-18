import { nanoid } from '@/lib/utils'
import { Chat } from '@/components/chat'
import { ManualTracing } from '@/lib/chat/manual'
import { auth } from '@/auth'
import { Session } from '@/lib/types'
import { getMissingKeys } from '@/app/actions'

export const metadata = {
  title: 'Manual Tracing Example'
}

export default async function IndexPage() {
  const id = nanoid()
  const session = (await auth()) as Session
  const missingKeys = await getMissingKeys()

  return (
    <>
      <div className="text-center w-full absolute pt-1">
        Manual Tracing Example
      </div>
      <ManualTracing initialAIState={{ chatId: id, messages: [] }}>
        <Chat id={id} session={session} missingKeys={missingKeys} />
      </ManualTracing>
    </>
  )
}
