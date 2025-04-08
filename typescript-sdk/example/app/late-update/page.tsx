import { nanoid } from '@/lib/utils'
import { Chat } from '@/components/chat'
import { auth } from '@/auth'
import { Session } from '@/lib/types'
import { getMissingKeys } from '@/app/actions'
import { LateUpdateTracing } from '../../lib/chat/late-update'

export const metadata = {
  title: 'Late Update Tracing Example'
}

export default async function IndexPage() {
  const id = nanoid()
  const session = (await auth()) as Session
  const missingKeys = await getMissingKeys()

  return (
    <>
      <div className="text-center w-full absolute pt-1">
        Late Update Tracing Example
      </div>
      <LateUpdateTracing initialAIState={{ chatId: id, messages: [] }}>
        <Chat id={id} session={session} missingKeys={missingKeys} />
      </LateUpdateTracing>
    </>
  )
}
